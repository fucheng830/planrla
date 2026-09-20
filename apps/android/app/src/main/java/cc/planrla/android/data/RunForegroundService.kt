package cc.planrla.android.data

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import cc.planrla.android.ui.App

/**
 * Foreground service that anchors the "run in progress" notification while the app is
 * backgrounded during an active chat run. The run itself executes on the Planrla Desktop
 * host; this service only keeps the notification (and with it, the process priority) alive
 * so the OS is less likely to drop the WebSocket while the user is away. Started from
 * MainActivity when the app backgrounds with a run active (App.activeRun), stopped on
 * foregrounding or run completion.
 *
 * Single-run model: navigation replaces the chat route, so only one ChatViewModel lives at
 * a time; its state is mirrored into the companion fields below.
 */
class RunForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_ABORT) {
            // "Stop" action on the notification: abort the run via the hook the
            // ChatViewModel installed. The Complete/Error event (or abort() directly)
            // tears down the rest; here we only drop the ongoing notification so the
            // user is not left with a stale progress bar if the connection is gone.
            App.abortActiveRun?.invoke()
            running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        sid = intent?.getStringExtra(RunNotification.EXTRA_SESSION_ID) ?: sid
        providerName = intent?.getStringExtra(RunNotification.EXTRA_PROVIDER) ?: providerName
        running = true
        val n = RunNotification.progress(this, sid, providerName, step)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, n)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ACTIVE = "planrla_run_active"
        const val CHANNEL_RUN = "planrla_run"
        /** Heads-up channel for permission prompts and input requests. */
        const val CHANNEL_PERM = "planrla_perm"
        const val NOTIF_ID = 42
        const val PERM_NOTIF_ID = 43
        /** Notification action: abort the active run (wired to App.abortActiveRun). */
        const val ACTION_ABORT = "cc.planrla.android.ABORT_RUN"
        private const val ACTION_STOP = "cc.planrla.android.STOP_RUN"

        @Volatile private var running = false
        @Volatile private var sid = ""
        @Volatile private var providerName: String? = null
        @Volatile private var step: String? = null
        /** Wall-clock start of the current run; anchors the notification chronometer
         *  across step updates so elapsed time never resets mid-run. */
        @Volatile private var startedAtMs = 0L

        /** Called when the app backgrounds with an active run: anchor the progress notification. */
        fun start(ctx: Context, sessionId: String, providerDisplayName: String?) {
            step = null
            startedAtMs = System.currentTimeMillis()
            ctx.startForegroundService(
                Intent(ctx, RunForegroundService::class.java)
                    .putExtra(RunNotification.EXTRA_SESSION_ID, sessionId)
                    .putExtra(RunNotification.EXTRA_PROVIDER, providerDisplayName)
            )
        }

        /** Called on foregrounding or run completion; removes the ongoing notification. */
        fun stop(ctx: Context) {
            running = false
            ctx.stopService(Intent(ctx, RunForegroundService::class.java))
        }

        /** Live-update the notification body with the currently executing tool (best-effort). */
        fun updateStep(ctx: Context, toolName: String?) {
            if (!running) return
            step = toolName?.takeIf { it.isNotBlank() } ?: return
            runCatching {
                NotificationManagerCompat.from(ctx)
                    .notify(NOTIF_ID, RunNotification.progress(ctx, sid, providerName, step, startedAtMs))
            }
        }

        /** Terminal state: stop the service and post the completion notification. */
        fun finish(
            ctx: Context,
            sessionId: String,
            providerName: String?,
            ok: Boolean,
            summary: String?,
        ) {
            running = false
            step = null
            ctx.stopService(Intent(ctx, RunForegroundService::class.java))
            runCatching {
                NotificationManagerCompat.from(ctx)
                    .notify(
                        sessionId.hashCode(),
                        RunNotification.finished(ctx, sessionId, providerName, ok, summary),
                    )
            }
        }
    }
}
