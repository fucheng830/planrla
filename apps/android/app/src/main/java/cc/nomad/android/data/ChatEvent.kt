package cc.nomad.android.data

import kotlinx.serialization.json.JsonElement

/** UI-facing event derived from a nomad NormalizedMessage. */
sealed class ChatEvent {
    data class TextDelta(val text: String) : ChatEvent()
    data class TextMessage(val text: String, val role: String?) : ChatEvent()
    data class Thinking(val text: String) : ChatEvent()
    data class ToolUse(
        val toolName: String?,
        val input: JsonElement?,
        val toolId: String?
    ) : ChatEvent()
    data class ToolResultEv(
        val toolId: String?,
        val content: String?,
        val isError: Boolean
    ) : ChatEvent()
    data class PermissionRequest(
        val requestId: String,
        val toolName: String?,
        val input: JsonElement?
    ) : ChatEvent()
    data class PermissionCancelled(val requestId: String) : ChatEvent()
    data class TokenBudgetEv(val used: Int, val total: Int, val input: Int, val output: Int) : ChatEvent()
    data class SessionCreated(val sessionId: String) : ChatEvent()
    data class ErrorEv(val message: String) : ChatEvent()
    /** Socket (re)opened. VM uses this to (re)subscribe via chat.subscribe. */
    data class Connected(val isFirst: Boolean) : ChatEvent()
    /** Gateway ack for chat.subscribe: drives working spinner + pending permissions. */
    data class ChatSubscribed(
        val sessionId: String,
        val isProcessing: Boolean,
        val lastSeq: Long,
        val pendingPermissions: List<PendingPermission>
    ) : ChatEvent()
    /** Gateway protocol_error (SESSION_NOT_FOUND / RUN_IN_PROGRESS / …). Terminal for a send. */
    data class ProtocolError(val code: String, val error: String, val sessionId: String?) : ChatEvent()
    object StreamEnd : ChatEvent()
    object Complete : ChatEvent()
    object Other : ChatEvent()
}

/** Map a NormalizedMessage to a ChatEvent. Server uses `kind`, some legacy msgs use `type`. */
fun NormalizedMessage.toChatEvent(): ChatEvent? {
    val kindStr = typeField ?: kind?.name ?: return null
    val text = content ?: text
    return when (kindStr) {
        "stream_delta" -> text?.let { ChatEvent.TextDelta(it) }
        "text" -> text?.let { ChatEvent.TextMessage(it, role) }
        "thinking" -> text?.let { ChatEvent.Thinking(it) }
        "tool_use" -> ChatEvent.ToolUse(toolName, toolInput ?: input, toolId)
        "tool_result" -> ChatEvent.ToolResultEv(toolId, toolResult?.content, toolResult?.isError ?: false)
        "permission_request" -> requestId?.let { ChatEvent.PermissionRequest(it, toolName, input ?: toolInput) }
        "permission_cancelled" -> requestId?.let { ChatEvent.PermissionCancelled(it) }
        "status" -> tokenBudget?.let { ChatEvent.TokenBudgetEv(it.used ?: 0, it.total ?: 0, it.inputTokens ?: 0, it.outputTokens ?: 0) }
        "session_created" -> (newSessionId ?: sessionId)?.let { ChatEvent.SessionCreated(it) }
        // Less-common kinds — surface their content instead of dropping to Other.
        "interactive_prompt" -> text?.let { ChatEvent.TextMessage(it, null) }
        "task_notification" -> text?.let { ChatEvent.TextMessage(it, null) }
        "stream_end" -> ChatEvent.StreamEnd
        "complete" -> ChatEvent.Complete
        "error" -> ChatEvent.ErrorEv(text ?: reason ?: errorStr ?: "error")
        else -> ChatEvent.Other
    }
}
