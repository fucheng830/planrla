package cc.nomad.android.data

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.channels.SendChannel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

object NetworkModule {
    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    fun okHttp(tokenHolder: TokenHolder): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .addInterceptor(AuthInterceptor(tokenHolder))
        .addInterceptor(EnvelopeUnwrapInterceptor())
        .build()

    private fun normalizeBase(baseUrl: String): String =
        if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

    fun retrofit(baseUrl: String, client: OkHttpClient): Retrofit2 = Retrofit2(baseUrl, client)
}

/** Unwraps the fork server's `{success, data}` envelope into `data` so the phone's flat
 *  response models (MessagesResponse, CreateSessionResponse, …) parse correctly. Bare
 *  responses (projects array, login object, relay account API) pass through unchanged. */
class EnvelopeUnwrapInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val resp = chain.proceed(chain.request())
        val ct = resp.body?.contentType() ?: return resp
        // Only unwrap JSON responses. Skip binary/octet-stream (file downloads) to avoid
        // reading large bodies into memory.
        if (ct.subtype != "json") return resp
        // Skip very large responses (> 1MB) to avoid OOM on big JSON payloads.
        val len = resp.body?.contentLength() ?: -1
        if (len > 1_000_000) return resp
        val raw = resp.body?.string() ?: return resp
        val out = runCatching {
            val obj = NetworkModule.json.decodeFromString(JsonElement.serializer(), raw) as? JsonObject
            val d = obj?.get("data")
            if (obj?.get("success") != null && d != null && d !is JsonNull) {
                NetworkModule.json.encodeToString(JsonElement.serializer(), d)
            } else raw
        }.getOrDefault(raw)
        return resp.newBuilder().body(out.toResponseBody(ct)).build()
    }
}

/** Retrofit wrapper built around a dynamic base URL. */
class Retrofit2(baseUrl: String, client: OkHttpClient) {
    private val retrofit = retrofit2.Retrofit.Builder()
        .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
        .client(client)
        .addConverterFactory(NetworkModule.json.asConverterFactory("application/json".toMediaType()))
        .build()

    val auth: AuthApi = retrofit.create(AuthApi::class.java)
    val project: ProjectApi = retrofit.create(ProjectApi::class.java)
    val command: CommandApi = retrofit.create(CommandApi::class.java)
    val git: GitApi = retrofit.create(GitApi::class.java)
    val session: SessionApi = retrofit.create(SessionApi::class.java)
    val account: AccountApi = retrofit.create(AccountApi::class.java)
    val providerInfo: ProviderInfoApi = retrofit.create(ProviderInfoApi::class.java)
    val plugins: PluginsApi = retrofit.create(PluginsApi::class.java)
    val taskmaster: TaskMasterApi = retrofit.create(TaskMasterApi::class.java)
    val settings: SettingsApi = retrofit.create(SettingsApi::class.java)
}

class TokenHolder {
    @Volatile var token: String? = null
    @Volatile var relayToken: String? = null
}

class AuthInterceptor(private val holder: TokenHolder) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val b = chain.request().newBuilder()
        holder.relayToken?.let { b.addHeader("x-relay-token", it) }
        holder.token?.let { b.addHeader("Authorization", "Bearer $it") }
        return chain.proceed(b.build())
    }
}

class ApiProvider(val serverUrl: String, client: OkHttpClient) {
    private val r = NetworkModule.retrofit(serverUrl, client)
    val auth: AuthApi = r.auth
    val project: ProjectApi = r.project
    val command: CommandApi = r.command
    val git: GitApi = r.git
    val session: SessionApi = r.session
    val account: AccountApi = r.account
    val providerInfo: ProviderInfoApi = r.providerInfo
    val plugins: PluginsApi = r.plugins
    val taskmaster: TaskMasterApi = r.taskmaster
    val settings: SettingsApi = r.settings
}

/** OkHttp WebSocket client for nomad /ws. Pushes parsed ChatEvent into a channel. */
class ChatSocket(
    private val client: OkHttpClient,
    private val json: Json = NetworkModule.json
) {
    private var ws: WebSocket? = null
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    @Volatile private var shouldReconnect = false
    private var reconnectDelayMs = 1000L
    private var hasOpened = false
    /** Highest seq seen for the current session — sent on chat.subscribe so the server only
     *  replays seq > lastSeq. Tracked here (not in the VM) so it survives WS reconnect. */
    private var lastSeq = 0L
    private var args: ConnectArgs? = null
    private data class ConnectArgs(val serverUrl: String, val token: String?, val relayToken: String?, val events: SendChannel<ChatEvent>)

    fun connect(serverUrl: String, token: String?, relayToken: String?, events: SendChannel<ChatEvent>) {
        shouldReconnect = true
        reconnectDelayMs = 1000L
        args = ConnectArgs(serverUrl, token, relayToken, events)
        openWs()
    }

    private fun openWs() {
        val a = args ?: return
        val base = if (a.serverUrl.endsWith("/")) a.serverUrl.dropLast(1) else a.serverUrl
        val wsAuth = a.relayToken ?: a.token
        val wsUrl = base.replaceFirst(Regex("^http"), "ws") + "/ws?token=$wsAuth"
        val req = Request.Builder().url(wsUrl).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectDelayMs = 1000L
                val first = !hasOpened
                hasOpened = true
                a.events.trySend(ChatEvent.Connected(first))
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                text.split("\n").forEach { line ->
                    val l = line.trim()
                    if (l.isEmpty() || !l.startsWith("{")) return@forEach
                    runCatching {
                        val obj = json.decodeFromString(JsonObject.serializer(), l)
                        when (obj["kind"]?.jsonPrimitive?.contentOrNull) {
                            "chat_subscribed" -> parseChatSubscribed(obj)?.let { a.events.trySend(it) }
                            "protocol_error" -> a.events.trySend(
                                ChatEvent.ProtocolError(
                                    code = obj["code"]?.jsonPrimitive?.contentOrNull ?: "PROTOCOL_ERROR",
                                    error = obj["error"]?.jsonPrimitive?.contentOrNull ?: "protocol error",
                                    sessionId = obj["sessionId"]?.jsonPrimitive?.contentOrNull,
                                )
                            )
                            else -> {
                                val nm = json.decodeFromString(NormalizedMessage.serializer(), l)
                                nm.seq?.let { if (it > lastSeq) lastSeq = it }
                                nm.toChatEvent()?.let { a.events.trySend(it) }
                            }
                        }
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scheduleReconnect()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val delay = reconnectDelayMs
        reconnectDelayMs = (reconnectDelayMs * 2).coerceAtMost(30_000L)
        handler.postDelayed({ openWs() }, delay)
    }

    /** chat.send — sessionId + content top-level; options carries composer prefs only
     *  (server resolves provider/sessionId/resume/projectPath from the session row). */
    fun sendChat(
        sessionId: String,
        content: String,
        cwd: String?,
        permissionMode: String? = null,
        images: List<Pair<String, String>> = emptyList()
    ) {
        val msg = buildJsonObject {
            put("type", "chat.send")
            put("sessionId", sessionId)
            put("content", content)
            putJsonObject("options") {
                cwd?.let { put("cwd", it) }
                permissionMode?.let { put("permissionMode", it) }
                if (images.isNotEmpty()) {
                    putJsonArray("images") {
                        images.forEach { (data, name) ->
                            add(buildJsonObject {
                                put("data", data)
                                put("name", name)
                            })
                        }
                    }
                }
            }
        }
        ws?.send(msg.toString())
    }

    /** chat.subscribe — re-attach live stream + replay seq > lastSeq for a running session. */
    fun sendSubscribe(sessionId: String) {
        val msg = buildJsonObject {
            put("type", "chat.subscribe")
            putJsonArray("sessions") {
                add(buildJsonObject {
                    put("sessionId", sessionId)
                    put("lastSeq", lastSeq)
                })
            }
        }
        ws?.send(msg.toString())
    }

    fun sendPermissionResponse(requestId: String, allow: Boolean) {
        val msg = buildJsonObject {
            put("type", "chat.permission-response")
            put("requestId", requestId)
            put("allow", allow)
        }
        ws?.send(msg.toString())
    }

    fun sendAbort(sessionId: String) {
        val msg = buildJsonObject {
            put("type", "chat.abort")
            put("sessionId", sessionId)
        }
        ws?.send(msg.toString())
    }

    private fun parseChatSubscribed(obj: JsonObject): ChatEvent.ChatSubscribed? {
        val sid = obj["sessionId"]?.jsonPrimitive?.contentOrNull ?: return null
        val isProcessing = obj["isProcessing"]?.jsonPrimitive?.booleanOrNull ?: false
        val lastSeq = obj["lastSeq"]?.jsonPrimitive?.longOrNull ?: 0L
        val perms = obj["pendingPermissions"]?.jsonArray?.mapNotNull { el ->
            val o = el.jsonObject
            val rid = o["requestId"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            PendingPermission(
                requestId = rid,
                toolName = o["toolName"]?.jsonPrimitive?.contentOrNull,
                input = o["input"],
                context = o["context"],
                sessionId = o["sessionId"]?.jsonPrimitive?.contentOrNull,
            )
        } ?: emptyList()
        return ChatEvent.ChatSubscribed(sid, isProcessing, lastSeq, perms)
    }

    fun close() {
        shouldReconnect = false
        handler.removeCallbacksAndMessages(null)
        ws?.close(1000, "bye")
        ws = null
    }
}
