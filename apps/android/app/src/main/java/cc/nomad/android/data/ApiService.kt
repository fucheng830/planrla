package cc.nomad.android.data

import kotlinx.serialization.Serializable
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface AuthApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @GET("api/auth/user")
    suspend fun user(): UserInfo
}

interface ProjectApi {
    @GET("api/projects")
    suspend fun projects(): List<Project>

    @POST("api/projects/create-project")
    suspend fun createProject(@Body body: CreateProjectRequest): Project

    @GET("api/providers/sessions/{sessionId}/messages")
    suspend fun messages(
        @Path("sessionId") sid: String,
        @Query("limit") limit: Int? = 50,
        @Query("offset") offset: Int? = 0
    ): MessagesResponse

    @POST("api/projects/{projectId}/toggle-star")
    suspend fun toggleStar(@Path("projectId") id: String): ToggleStarResponse

    @GET("api/projects/{projectId}/files")
    suspend fun files(@Path("projectId") id: String): List<FileNode>

    @Streaming
    @GET("api/projects/{projectId}/files/content")
    suspend fun fileContent(
        @Path("projectId") id: String,
        @Query("path") path: String
    ): ResponseBody

    @GET("api/projects/{projectId}/sessions")
    suspend fun sessions(@Path("projectId") id: String): SessionsResponse

    @PUT("api/projects/{projectId}/rename")
    suspend fun renameProject(@Path("projectId") id: String, @Body body: RenameProjectRequest): SessionOpResponse

    @DELETE("api/projects/{projectId}")
    suspend fun deleteProject(@Path("projectId") id: String, @Query("force") force: Boolean = false): SessionOpResponse

    // ---- File write operations (Files tab edit/create/delete/rename) ----
    @PUT("api/projects/{projectId}/file")
    suspend fun saveFile(@Path("projectId") id: String, @Body body: SaveFileRequest): SessionOpResponse

    @POST("api/projects/{projectId}/files/create")
    suspend fun createFile(@Path("projectId") id: String, @Body body: CreateFileRequest): SessionOpResponse

    @DELETE("api/projects/{projectId}/files")
    suspend fun deleteFile(@Path("projectId") id: String, @Query("filePath") filePath: String): SessionOpResponse

    @PUT("api/projects/{projectId}/files/rename")
    suspend fun renameFile(@Path("projectId") id: String, @Body body: RenameFileRequest): SessionOpResponse

    /** Multipart upload (multer on server: parts named "files" + "relativePaths" form fields). */
    @Multipart
    @POST("api/projects/{projectId}/files/upload")
    suspend fun uploadFiles(
        @Path("projectId") id: String,
        @Part files: List<MultipartBody.Part>,
        @Part("relativePaths") relativePaths: List<RequestBody>
    ): SessionOpResponse
}

interface GitApi {
    @GET("api/git/status")
    suspend fun status(@Query("project") project: String): GitStatus

    @GET("api/git/branches")
    suspend fun branches(@Query("project") project: String): GitBranches

    @POST("api/git/checkout")
    suspend fun checkout(@Body body: CheckoutRequest): CheckoutResponse

    @POST("api/git/commit")
    suspend fun commit(@Body body: CommitRequest): CommitResponse

    @POST("api/git/generate-commit-message")
    suspend fun generateCommitMessage(@Body body: GenerateCommitMessageRequest): GenerateCommitMessageResponse

    @GET("api/git/file-with-diff")
    suspend fun fileWithDiff(
        @Query("project") project: String,
        @Query("file") file: String
    ): FileDiff

    // ---- Advanced git (diff view + remote ops + branches + history) ----
    @GET("api/git/diff")
    suspend fun diff(@Query("project") project: String, @Query("file") file: String): ResponseBody

    @POST("api/git/pull")
    suspend fun pull(@Body body: GitRemoteRequest): GitOpResponse

    @POST("api/git/push")
    suspend fun push(@Body body: GitRemoteRequest): GitOpResponse

    @POST("api/git/fetch")
    suspend fun fetch(@Body body: GitRemoteRequest): GitOpResponse

    @POST("api/git/create-branch")
    suspend fun createBranch(@Body body: CreateBranchRequest): GitOpResponse

    @GET("api/git/commits")
    suspend fun commits(@Query("project") project: String, @Query("limit") limit: Int = 50): ResponseBody

    @POST("api/git/discard")
    suspend fun discard(@Body body: DiscardRequest): GitOpResponse

    @POST("api/git/delete-branch")
    suspend fun deleteBranch(@Body body: DeleteBranchRequest): GitOpResponse

    @GET("api/git/remote-status")
    suspend fun remoteStatus(@Query("project") project: String): ResponseBody
}

interface SessionApi {
    /** chat.* protocol: mint a stable app session id before the first chat.send. */
    @POST("api/providers/sessions")
    suspend fun create(@Body body: CreateSessionRequest): CreateSessionResponse

    /** Archived sessions (for the Archive tab). Server returns {success,data:{sessions:[...]}}. */
    @GET("api/providers/sessions/archived")
    suspend fun archived(): SessionsResponse

    /** Restore an archived session. */
    @POST("api/providers/sessions/{sessionId}/restore")
    suspend fun restore(@Path("sessionId") id: String): SessionOpResponse

    @PUT("api/providers/sessions/{sessionId}")
    suspend fun rename(
        @Path("sessionId") id: String,
        @Body body: RenameSessionRequest
    ): SessionOpResponse

    @DELETE("api/providers/sessions/{sessionId}")
    suspend fun delete(
        @Path("sessionId") id: String,
        @Query("force") force: Boolean = false
    ): SessionOpResponse
}

@Serializable
data class MessagesResponse(
    val messages: List<NormalizedMessage> = emptyList(),
    val total: Int? = null,
    val hasMore: Boolean? = null
)

interface CommandApi {
    @POST("api/commands/list")
    suspend fun list(@Body body: CommandListRequest): CommandListResponse

    /** Execute a slash command server-side (built-in handler or custom .md with $ARGUMENTS). */
    @POST("api/commands/execute")
    suspend fun execute(@Body body: CommandExecuteRequest): CommandExecuteResponse
}

/** Provider capability surfaces (MCP servers / models / skills) — raw JSON, displayed read-only. */
interface ProviderInfoApi {
    @GET("api/providers/{provider}/mcp/servers")
    suspend fun mcpServers(@Path("provider") provider: String): ResponseBody

    @GET("api/providers/{provider}/models")
    suspend fun models(@Path("provider") provider: String): ResponseBody

    @GET("api/providers/{provider}/skills")
    suspend fun skills(@Path("provider") provider: String): ResponseBody

    @GET("api/providers/capabilities")
    suspend fun capabilities(): ResponseBody
}

/** Credentials & git identity settings (api keys, github creds, git user.name/email). */
interface SettingsApi {
    @GET("api/settings/api-keys")
    suspend fun apiKeys(): ResponseBody

    @POST("api/settings/api-keys")
    suspend fun createApiKey(@Body body: ApiKeyRequest): SessionOpResponse

    @DELETE("api/settings/api-keys/{keyId}")
    suspend fun deleteApiKey(@Path("keyId") id: String): SessionOpResponse

    @GET("api/settings/credentials")
    suspend fun credentials(@Query("type") type: String? = null): ResponseBody

    @POST("api/settings/credentials")
    suspend fun createCredential(@Body body: CredentialRequest): SessionOpResponse

    @DELETE("api/settings/credentials/{credentialId}")
    suspend fun deleteCredential(@Path("credentialId") id: String): SessionOpResponse

    @GET("api/user/git-config")
    suspend fun gitConfig(): ResponseBody

    @POST("api/user/git-config")
    suspend fun setGitConfig(@Body body: GitConfigRequest): SessionOpResponse
}

interface PluginsApi {
    @GET("api/plugins/")
    suspend fun list(): ResponseBody
}

interface TaskMasterApi {
    @GET("api/taskmaster/installation-status")
    suspend fun status(): ResponseBody
}

/** Account/auth API on the relay (cc.brainmate.cc). Bearer = account JWT. */
interface AccountApi {
    @POST("api/auth/signup")
    suspend fun signup(@Body body: AccountLoginRequest): AccountAuthResponse

    @POST("api/auth/login")
    suspend fun login(@Body body: AccountLoginRequest): AccountAuthResponse

    @GET("api/devices")
    suspend fun devices(@Header("Authorization") auth: String): AccountDevicesResponse
}

@Serializable
data class AccountLoginRequest(val email: String, val password: String)

@Serializable
data class AccountUser(val id: String, val email: String, val plan: String = "free")

@Serializable
data class AccountAuthResponse(val token: String, val user: AccountUser)

@Serializable
data class AccountDevice(val id: String, val token: String, val name: String = "")

@Serializable
data class AccountDevicesResponse(val devices: List<AccountDevice> = emptyList())

@Serializable
data class CommandListRequest(val provider: String = "claude", val sessionId: String? = null)

@Serializable
data class CommandExecuteRequest(
    val command: String,
    val args: String = "",
    val provider: String = "claude",
    val sessionId: String? = null
)

@Serializable
data class CommandExecuteResponse(
    val success: Boolean? = null,
    val output: String? = null,
    val result: String? = null,
    val error: String? = null
)
