package cc.planrla.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class MessageKind {
    text, tool_use, tool_result, thinking, stream_delta, stream_end,
    error, complete, status, permission_request, permission_cancelled,
    session_created, interactive_prompt, task_notification
}

@Serializable
data class ToolResult(
    val content: String? = null,
    val isError: Boolean? = null
)

@Serializable
data class TokenBudget(
    val used: Int? = null,
    val total: Int? = null,
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val cacheReadTokens: Int? = null,
    val cacheCreationTokens: Int? = null,
    val cacheTokens: Int? = null,
)

@Serializable
data class CommandInfo(
    val name: String? = null,
    val description: String? = null,
    val namespace: String? = null,
)

@Serializable
data class CommandListResponse(
    val builtIn: List<CommandInfo> = emptyList(),
    val custom: List<CommandInfo> = emptyList(),
    val count: Int? = null,
)

/** planrla WS/REST NormalizedMessage envelope (server/shared/types.ts). */
@Serializable
data class NormalizedMessage(
    val id: String? = null,
    val sessionId: String? = null,
    val timestamp: String? = null,
    val provider: String? = null,
    val kind: MessageKind? = null,
    val role: String? = null,
    val content: String? = null,
    val text: String? = null,
    val toolName: String? = null,
    val toolInput: JsonElement? = null,
    val toolId: String? = null,
    val toolResult: ToolResult? = null,
    val requestId: String? = null,
    val input: JsonElement? = null,
    val reason: String? = null,
    val newSessionId: String? = null,
    val status: String? = null,
    val isError: Boolean? = null,
    val tokens: Int? = null,
    val tokenBudget: TokenBudget? = null,
    val canInterrupt: Boolean? = null,
    val seq: Long? = null,
    @SerialName("type") val typeField: String? = null,
    @SerialName("error") val errorStr: String? = null
)

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class LoginResponse(
    val success: Boolean? = null,
    val token: String? = null,
    val user: UserInfo? = null
)

@Serializable
data class UserInfo(val id: String? = null, val username: String? = null)

@Serializable
data class Project(
    val projectId: String,
    val path: String? = null,
    val fullPath: String? = null,
    val displayName: String? = null,
    val isStarred: Boolean? = null,
    val sessions: List<SessionInfo>? = null
)

@Serializable
data class SessionInfo(
    val id: String,
    val summary: String? = null,
    val messageCount: Int? = null,
    val lastActivity: String? = null,
    val provider: String? = null
)

@Serializable
data class SessionsResponse(val sessions: List<SessionInfo> = emptyList())

@Serializable
data class CreateProjectRequest(val path: String)

@Serializable
data class ToggleStarResponse(val success: Boolean? = null, val isStarred: Boolean? = null)

@Serializable
data class NewSessionRequest(val cwd: String? = null)

/** File tree node from GET /api/projects/:id/files (server getFileTree). */
@Serializable
data class FileNode(
    val name: String,
    val path: String,
    val type: String = "file",
    val size: Long? = null,
    val modified: String? = null,
    val children: List<FileNode>? = null
) {
    val isDirectory: Boolean get() = type == "directory"
}

@Serializable
data class GitStatus(
    val branch: String? = null,
    val hasCommits: Boolean? = null,
    val modified: List<String> = emptyList(),
    val added: List<String> = emptyList(),
    val deleted: List<String> = emptyList(),
    val untracked: List<String> = emptyList()
)

@Serializable
data class GitBranches(
    val branches: List<JsonElement> = emptyList(),
    val localBranches: List<String> = emptyList(),
    val remoteBranches: List<String> = emptyList()
)

@Serializable
data class CheckoutRequest(val project: String, val branch: String)

@Serializable
data class CheckoutResponse(val success: Boolean? = null, val output: String? = null)

@Serializable
data class CommitRequest(val project: String, val message: String, val files: List<String>)

@Serializable
data class CommitResponse(val success: Boolean? = null, val output: String? = null)

@Serializable
data class GenerateCommitMessageRequest(val project: String, val files: List<String>)

@Serializable
data class GenerateCommitMessageResponse(val message: String? = null)

@Serializable
data class FileDiff(val currentContent: String? = null)

@Serializable
data class RenameSessionRequest(val summary: String)

@Serializable
data class SessionOpResponse(val success: Boolean? = null)

// ---- chat.* new-protocol session lifecycle (REST) ----

/** POST /api/providers/sessions — create a stable app session id (required before chat.send).
 *  No default on `provider`: NetworkModule.json uses encodeDefaults=false, so a defaulted
 *  field would be omitted from the body and the server would reject with 400. */
@Serializable
data class CreateSessionRequest(val provider: String, val projectPath: String)

@Serializable
data class CreateSessionResponse(
    val sessionId: String,
    val provider: String? = null,
    val projectPath: String? = null
)

@Serializable
data class PendingPermission(
    val requestId: String,
    val toolName: String? = null,
    val input: JsonElement? = null,
    val context: JsonElement? = null,
    val sessionId: String? = null
)

// ---- File write ops (Files tab edit/create/delete/rename) ----
@Serializable
data class SaveFileRequest(val filePath: String, val content: String)
@Serializable
data class CreateFileRequest(val path: String, val type: String) // "file" | "directory"
@Serializable
data class RenameFileRequest(val oldPath: String, val newPath: String)

// ---- Advanced git ----
@Serializable
data class GitRemoteRequest(val project: String)
@Serializable
data class GitOpResponse(val success: Boolean? = null, val output: String? = null, val error: String? = null)
@Serializable
data class CreateBranchRequest(val project: String, val branch: String)
@Serializable
data class DiscardRequest(val project: String, val file: String)
@Serializable
data class DeleteBranchRequest(val project: String, val branch: String)
@Serializable
data class RenameProjectRequest(val name: String)

// ---- Settings (api keys, github creds, git identity) ----
@Serializable
data class ApiKeyRequest(val name: String)
@Serializable
data class CredentialRequest(
    val name: String,
    val type: String,
    val value: String,
    val description: String = ""
)
@Serializable
data class GitConfigRequest(
    val name: String? = null,
    val email: String? = null
)
@Serializable
data class CommitInfo(
    val hash: String? = null,
    val message: String? = null,
    val author: String? = null,
    val email: String? = null,
    val date: String? = null
)
