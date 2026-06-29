package cc.nomad.android.data

import cc.nomad.android.ui.App
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Cross-project full-text session search via the server's SSE endpoint.
 *
 * `GET /api/providers/search/sessions?q=<query>&limit=20` returns `text/event-stream` with
 * events of type `result` (one matched session), `progress`, `done`, `error`. Each event is
 * `event: <type>\ndata: <json>\n\n`.
 *
 * IMPORTANT: the SSE stream must NOT pass through [EnvelopeUnwrapInterceptor] — that interceptor
 * buffers and JSON-parses the whole body, which would corrupt the streaming SSE framing. So we
 * use a standalone [OkHttpClient] here (no interceptors) and add the auth headers manually by
 * reading [App.tokenHolder] (the same headers [AuthInterceptor] would inject).
 */
private val sseClient: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS) // streaming — never time out while waiting for events
    .build()

/**
 * Streams search results for [q] from [serverUrl]. Invokes [onResult] once per matched session
 * (in the dispatcher background thread) and [onDone] when the server ends the stream
 * (`done`/`error`) or the body is exhausted. Cancellation: coroutine cancellation propagates
 * via OkHttp's call.cancel() through the withContext's finally block.
 */
suspend fun searchSessions(
    serverUrl: String,
    q: String,
    onResult: (SessionInfo) -> Unit,
    onDone: () -> Unit,
) = withContext(Dispatchers.IO) {
    val base = if (serverUrl.endsWith("/")) serverUrl.dropLast(1) else serverUrl
    val url = base.toHttpUrl().newBuilder()
        .addPathSegments("api/providers/search/sessions")
        .addQueryParameter("q", q)
        .addQueryParameter("limit", "20")
        .build()

    val reqBuilder = Request.Builder().url(url)
    App.tokenHolder.relayToken?.let { reqBuilder.addHeader("x-relay-token", it) }
    App.tokenHolder.token?.let { reqBuilder.addHeader("Authorization", "Bearer $it") }
    reqBuilder.addHeader("Accept", "text/event-stream")

    val call = sseClient.newCall(reqBuilder.build())
    var currentEvent = "message"
    try {
        val resp = call.execute()
        if (!resp.isSuccessful) {
            resp.close()
            onDone()
            return@withContext
        }
        val source = resp.body?.source() ?: run { resp.close(); onDone(); return@withContext }
        try {
            // SSE framing: read line-by-line. Lines starting with "data:" carry the JSON payload
            // (may be empty — the blank-line event terminator). Lines starting with "event:" set
            // the event type for the next terminator. A blank line dispatches the buffered event.
            while (true) {
                val line = source.readUtf8Line() ?: break // EOF
                when {
                    line.startsWith("event:") -> {
                        currentEvent = line.removePrefix("event:").trim()
                    }
                    line.startsWith("data:") -> {
                        val payload = line.removePrefix("data:").trimStart()
                        if (payload.isEmpty()) continue
                        if (currentEvent == "result") {
                            parseSessionInfo(payload)?.let(onResult)
                        }
                        // `done`/`error` carry a JSON body too but we don't need its contents;
                        // they are detected by the event: line above and the stream ending below.
                    }
                    line.isEmpty() -> {
                        if (currentEvent == "done" || currentEvent == "error") break
                        currentEvent = "message"
                    }
                }
            }
        } finally {
            resp.close()
        }
    } catch (e: Exception) {
        // Network errors / parse failures just end the stream — UI keeps whatever arrived.
    } finally {
        onDone()
    }
}

/** Best-effort extraction of SessionInfo fields from a SSE `result` data JSON object.
 *  Tolerates extra/missing fields (server may add project path, cwd, etc.). */
private fun parseSessionInfo(jsonStr: String): SessionInfo? = runCatching {
    val obj = NetworkModule.json.parseToJsonElement(jsonStr).jsonObject
    // The server's search result may nest the session under `session`/`item`, or inline it.
    val s = obj["session"]?.jsonObject ?: obj["item"]?.jsonObject ?: obj
    val id = s["id"]?.jsonPrimitive?.contentOrNull
        ?: s["sessionId"]?.jsonPrimitive?.contentOrNull
        ?: return@runCatching null
    SessionInfo(
        id = id,
        summary = s["summary"]?.jsonPrimitive?.contentOrNull,
        messageCount = s["messageCount"]?.jsonPrimitive?.intOrNull,
        lastActivity = s["lastActivity"]?.jsonPrimitive?.contentOrNull,
    )
}.getOrNull()
