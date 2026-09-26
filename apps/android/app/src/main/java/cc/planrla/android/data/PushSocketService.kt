package cc.planrla.android.data

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import cc.planrla.android.ui.App
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.net.URLEncoder

/**
 * Remote-run push channel.
 *
 * The existing RunForegroundService only notifies about runs whose ChatViewModel is
 * alive on the phone (i.e. runs started from the phone). Runs started on the desktop,
 * or scheduled/cron runs, finish with nobody listening — the phone never learns.
 *
 * This service owns a lightweight always-on WebSocket that listens for the server's
 * `background-task-updated` broadcasts (which fire for every chat run transition,
 * including desktop-initiated and cron runs). When a chat task reaches a terminal
 * status while the app is backgrounded, it posts the same deep-linking completion
 * notification RunNotification.finished builds.
 *
 * Deliberately foreground-service based rather than FCM: planrla is a self-hosted
 * desktop product (no Google-services dependency wanted), the phone already talks
 * to the desktop either over LAN or through the planrla relay, and a dataSync
 * foreground service keeps the process alive reliably on modern Android.
 */
class PushSocketService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ws: okhttp3.WebSocket? = null
    private var reconnectMs = 2000L
    private val json = Json { ignoreUnknownKeys = true }

    /** Recently notified terminal task ids — the registry may emit idle twice
     *  (running→idle on complete, then TTL cleanup); suppress duplicates. */
    private val notified = HashSet<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        scope.launch { runLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Already running (created via startForegroundService from App);
        // re-foreground in case the notification was dismissed.
        startInForeground()
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        ws?.close(1000, "service destroyed")
        super.onDestroy()
    }

    private fun startInForeground() {
        val n = persistentNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    /** Low-importance persistent notification required by the foreground service.
     *  Silent: the run channels (not this one) do the talking. */
    private fun persistentNotification(): Notification {
        val pi = android.app.PendingIntent.getActivity(
            this, 0, packageManager.getLaunchIntentForPackage(packageName),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        return androidx.core.app.NotificationCompat.Builder(this, RunForegroundService.CHANNEL_ACTIVE)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(getString(cc.planrla.android.R.string.push_service_title))
            .setContentText(getString(cc.planrla.android.R.string.push_service_body))
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pi)
            .build()
    }

    private suspend fun runLoop() {
        while (scope.isActive) {
            val device = runCatching { App.tokenStore.currentDevice() }.getOrNull()
            val serverUrl = runCatching { App.tokenStore.serverUrlSync() }.getOrNull()
            if (serverUrl.isNullOrBlank()) {
                delay(POLL_IDLE_MS)
                continue
            }
            // Prefer the same resolution the app uses (LAN direct when reachable,
            // relay otherwise). resolveBaseUrl also rotates the TokenHolder into the
            // right credential mode for the socket's auth query param.
            val base = runCatching { App.resolveBaseUrl() }.getOrNull() ?: serverUrl
            // resolveBaseUrl writes the fresh LAN JWT into TokenHolder (memory),
            // NOT DataStore — tokenStore.tokenSync() would return a stale JWT
            // from a previous server instance and the upgrade gets 401'd.
            // Read TokenHolder first; DataStore is only the cold-start fallback
            // (before the UI has ever resolved a base URL).
            val relayToken = App.tokenHolder.relayToken
                ?: runCatching { App.tokenStore.relayTokenSync() }.getOrNull()
            val token = App.tokenHolder.token
                ?: runCatching { App.tokenStore.tokenSync() }.getOrNull()
            val wsAuth = relayToken?.takeIf { it.isNotBlank() } ?: token?.takeIf { it.isNotBlank() }
            connectOnce(base, wsAuth)
            // connectOnce returns only on socket close/failure.
            delay(reconnectMs)
            reconnectMs = (reconnectMs * 2).coerceAtMost(MAX_RECONNECT_MS)
        }
    }

    /** Opens one WebSocket and suspends until it closes. Reconnect handled by runLoop. */
    private suspend fun connectOnce(base: String, wsAuth: String?) {
        val url = base.trimEnd('/')
            .replaceFirst(Regex("^http"), "ws") + "/ws" +
            (wsAuth?.let { "?token=${URLEncoder.encode(it, "UTF-8")}" } ?: "")
        val req = okhttp3.Request.Builder().url(url).build()
        val client = okhttp3.OkHttpClient.Builder()
            .pingInterval(30, java.util.concurrent.TimeUnit.SECONDS)
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .build()
        val closed = kotlinx.coroutines.CompletableDeferred<Unit>()
        ws = client.newWebSocket(req, object : okhttp3.WebSocketListener() {
            override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                reconnectMs = 2000L
                // Backfill: a run may have finished while we were disconnected —
                // the registry broadcast is one-shot. Pull the task list once and
                // run the same terminal-state handler over it.
                scope.launch { backfillTerminalTasks(base, wsAuth) }
            }

            override fun onMessage(webSocket: okhttp3.WebSocket, text: String) {
                handleBroadcast(text)
            }

            override fun onFailure(webSocket: okhttp3.WebSocket, t: Throwable, response: okhttp3.Response?) {
                closed.complete(Unit)
            }

            override fun onClosed(webSocket: okhttp3.WebSocket, code: Int, reason: String) {
                closed.complete(Unit)
            }
        })
        closed.await()
    }

    /** REST catch-up after a (re)connect: notify about chat tasks that reached
     *  a terminal state while no socket was attached. */
    private suspend fun backfillTerminalTasks(base: String, wsAuth: String?) {
        runCatching {
            val url = base.trimEnd('/') + "/api/background-tasks" +
                (wsAuth?.let { "?token=${URLEncoder.encode(it, "UTF-8")}" } ?: "")
            val req = okhttp3.Request.Builder().url(url).build()
            okhttp3.OkHttpClient.Builder()
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .build()
                .newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@runCatching
                    val body = resp.body?.string() ?: return@runCatching
                    val obj = json.decodeFromString(JsonObject.serializer(), body)
                    (obj["tasks"] as? kotlinx.serialization.json.JsonArray)?.forEach { el ->
                        val frame = buildJsonObject {
                            put("type", "background-task-updated")
                            put("task", el)
                        }
                        handleBroadcast(json.encodeToString(JsonObject.serializer(), frame))
                    }
                }
        }
    }

    /** Parses one `background-task-updated` frame and posts a completion
     *  notification for terminal chat tasks while the app is backgrounded. */
    private fun handleBroadcast(text: String) {
        val obj = runCatching {
            json.decodeFromString(JsonObject.serializer(), text)
        }.getOrNull() ?: return
        if (obj["type"]?.jsonPrimitive?.contentOrNull != "background-task-updated") return
        val task = obj["task"]?.jsonObject ?: return
        if (task["type"]?.jsonPrimitive?.contentOrNull != "chat") return
        val status = task["status"]?.jsonPrimitive?.contentOrNull ?: return
        // chat registry flips running→idle when the run completes; treat idle
        // as terminal for chat tasks (registry never sends completed for chat).
        if (status !in TERMINAL_STATUSES) return

        val detail = task["detail"]?.jsonObject ?: return
        val sessionId = detail["appSessionId"]?.jsonPrimitive?.contentOrNull ?: return
        val taskId = task["id"]?.jsonPrimitive?.contentOrNull ?: sessionId
        if (!notified.add(taskId)) return

        // Foreground: the app's own UI is visible (its ChatViewModel handles its
        // runs; desktop-run completion also shows via session list refresh) —
        // no notification wanted.
        if (App.isForeground) return

        val provider = detail["provider"]?.jsonPrimitive?.contentOrNull
        // Server-side completion preview (assistant reply first line, falls back
        // to the last user prompt) — same rule as ChatScreen's own notification.
        val preview = detail["preview"]?.jsonPrimitive?.contentOrNull
        val ok = status != "failed" && status != "killed"
        val title = provider ?: getString(cc.planrla.android.R.string.push_task_default_provider)
        runCatching {
            NotificationManagerCompat.from(this).notify(
                sessionId.hashCode(),
                RunNotification.finished(this, sessionId, title, ok, preview),
            )
        }
    }

    companion object {
        const val NOTIF_ID = 50
        const val ACTION_STOP = "cc.planrla.android.STOP_PUSH"
        private const val POLL_IDLE_MS = 10_000L
        private const val MAX_RECONNECT_MS = 30_000L
        /** chat tasks only ever reach idle (not completed) — registry semantics. */
        private val TERMINAL_STATUSES = setOf("idle", "completed", "failed", "killed")

        /**
         * Start the push channel after a device is configured. Idempotent.
         *
         * 冷启动无条件 startForegroundService 会在系统繁忙(开机风暴/低配机)时踩
         * 「5s 内未 startForeground」ANR——且全新安装无设备时服务本来就在空转轮询。
         * 故仅在已配置设备或已登录账号时才拉起;异步判定避免在主线程读 DataStore。
         */
        fun start(ctx: Context) {
            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                val hasWork = runCatching {
                    App.tokenStore.currentDevice() != null || App.tokenStore.accountJwtSync() != null
                }.getOrDefault(false)
                if (!hasWork) return@launch
                runCatching {
                    ctx.startForegroundService(
                        Intent(ctx, PushSocketService::class.java)
                    )
                }
            }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, PushSocketService::class.java)) }
        }
    }
}
