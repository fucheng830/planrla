package cc.planrla.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.speech.RecognizerIntent
import android.util.Base64
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.viewModelScope
import cc.planrla.android.data.ChatEvent
import cc.planrla.android.data.ChatSocket
import cc.planrla.android.data.CheckoutRequest
import cc.planrla.android.data.CommitRequest
import cc.planrla.android.data.CreateSessionRequest
import cc.planrla.android.R
import cc.planrla.android.data.FileDiff
import cc.planrla.android.data.GenerateCommitMessageRequest
import cc.planrla.android.data.GitOpResponse
import cc.planrla.android.data.GitRemoteRequest
import cc.planrla.android.data.GitStatus
import cc.planrla.android.data.CommandInfo
import cc.planrla.android.data.CommandListRequest
import cc.planrla.android.data.CommandExecuteRequest
import cc.planrla.android.data.CommitInfo
import cc.planrla.android.data.DeleteBranchRequest
import cc.planrla.android.data.Device
import cc.planrla.android.data.DiscardRequest
import cc.planrla.android.data.LoginRequest
import cc.planrla.android.data.NormalizedMessage
import cc.planrla.android.data.SessionInfo
import cc.planrla.android.data.TokenBudget
import cc.planrla.android.data.NetworkModule
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.ResponseBody

// planrla shadcn palette (hardcoded tailwind values from the web app)
private val UserBubbleBlue = Color(0xFF2563EB)     // bg-blue-600 (user bubble / Sign In)
private val ClaudeCoral = Color(0xFFD97757)         // Claude brand mark
private val ToolAvatarGray = Color(0xFF6B7280)      // gray-600 (tool avatar, used in both themes)
private val ErrorRedLight = Color(0xFFEF4444)
private val UserTimestampBlue = Color(0xFFDBEAFE)   // blue-100 (user timestamp on blue bubble)
// AssistantTextGray removed — now uses MaterialTheme.colorScheme.onSurfaceVariant (theme-aware)

// Permission modes (server reads options.permissionMode; claude-sdk.js supported set)
private val PERMISSION_MODES = listOf("default", "plan", "acceptEdits", "auto", "bypassPermissions")
private val ModeColors = mapOf(
    "default" to ModeStyle(Color(0xFF64748B), Color(0xFF1E293B)),
    "plan" to ModeStyle(Color(0xFF3B82F6), Color(0x333B82F6)),
    "acceptEdits" to ModeStyle(Color(0xFF22C55E), Color(0x3322C55E)),
    "auto" to ModeStyle(Color(0xFF3B82F6), Color(0x333B82F6)),
    "bypassPermissions" to ModeStyle(Color(0xFFF97316), Color(0x33F97316)),
)
private data class ModeStyle(val text: Color, val bg: Color)
private fun parseTime(iso: String?): Long = iso?.let {
    runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
} ?: 0L

private fun fmtTime(epoch: Long): String {
    if (epoch <= 0L) return ""
    val zdt = java.time.Instant.ofEpochMilli(epoch).atZone(java.time.ZoneId.systemDefault())
    return "%02d:%02d".format(zdt.hour, zdt.minute)
}

class ChatViewModel(
    private val sessionId: String,
    private val cwd: String?,
    private val projectId: String?
) : ViewModel() {
    data class PermissionReq(val requestId: String, val toolName: String?, val input: String?)
    data class AttachImage(val dataUrl: String, val name: String)

    /** The provider for this session ("claude"/"codex"/...). Set from history messages'
     *  provider field or chat_subscribed. Used for correct branding + createSession + commands. */
    private val _sessionProvider = MutableStateFlow<String?>(null)
    val sessionProviderFlow: StateFlow<String?> = _sessionProvider
    private var sessionProvider: String?
        get() = _sessionProvider.value
        set(v) { _sessionProvider.value = v }

    private val _items = MutableStateFlow<List<ChatItem>>(emptyList())
    val items: StateFlow<List<ChatItem>> = _items
    private val _perms = MutableStateFlow<List<PermissionReq>>(emptyList())
    val perms: StateFlow<List<PermissionReq>> = _perms
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    private val _permissionMode = MutableStateFlow("default")
    val permissionMode: StateFlow<String> = _permissionMode
    private val _images = MutableStateFlow<List<AttachImage>>(emptyList())
    val images: StateFlow<List<AttachImage>> = _images
    private val _tokenBudget = MutableStateFlow<TokenBudget?>(null)
    val tokenBudget: StateFlow<TokenBudget?> = _tokenBudget
    private val _commands = MutableStateFlow<List<CommandInfo>>(emptyList())
    val commands: StateFlow<List<CommandInfo>> = _commands
    private val _sessions = MutableStateFlow<List<SessionInfo>>(emptyList())
    val sessions: StateFlow<List<SessionInfo>> = _sessions
    private val _working = MutableStateFlow(false)
    val working: StateFlow<Boolean> = _working
    private val _branch = MutableStateFlow<String?>(null)
    val branch: StateFlow<String?> = _branch
    private val _branches = MutableStateFlow<List<String>>(emptyList())
    val branches: StateFlow<List<String>> = _branches
    private val _branchPickerOpen = MutableStateFlow(false)
    val branchPickerOpen: StateFlow<Boolean> = _branchPickerOpen
    private val _gitStatus = MutableStateFlow<GitStatus?>(null)
    val gitStatus: StateFlow<GitStatus?> = _gitStatus
    private val _committing = MutableStateFlow(false)
    val committing: StateFlow<Boolean> = _committing
    private val _fileDiff = MutableStateFlow<Pair<String, FileDiff?>?>(null)
    val fileDiff: StateFlow<Pair<String, FileDiff?>?> = _fileDiff
    private val _staged = MutableStateFlow<Set<String>>(emptySet())
    val staged: StateFlow<Set<String>> = _staged
    private val _diff = MutableStateFlow<Pair<String, String?>?>(null)
    val diff: StateFlow<Pair<String, String?>?> = _diff
    private val _gitBusy = MutableStateFlow(false)
    val gitBusy: StateFlow<Boolean> = _gitBusy
    private val _remoteStatus = MutableStateFlow<String?>(null)
    val remoteStatus: StateFlow<String?> = _remoteStatus
    private val _commits = MutableStateFlow<List<CommitInfo>?>(null)
    val commits: StateFlow<List<CommitInfo>?> = _commits
    private val _commitsOpen = MutableStateFlow(false)
    val commitsOpen: StateFlow<Boolean> = _commitsOpen

    private var socket: ChatSocket? = null
    /** Resolved base URL (LAN-direct or relay) from start(); used for REST calls like createSession. */
    private var serverUrl: String? = null
    var currentSessionId: String? = sessionId.takeIf { it.isNotBlank() && it != "new" }

    fun start() {
        if (socket != null) return
        viewModelScope.launch(Dispatchers.IO) {
            val dev = App.tokenStore.currentDevice()
            var s: String = App.tokenStore.serverUrlSync() ?: return@launch
            var t: String? = App.tokenStore.tokenSync()
            var r: String? = dev?.token ?: App.tokenStore.relayTokenSync()
            // LAN-direct: probe the device's local planrla (4s); fall back to relay if unreachable.
            if (dev != null && !dev.lan.isNullOrBlank() && !dev.ccUser.isNullOrBlank()) {
                val lan = dev.lan
                val username = dev.ccUser
                val lanUrl = if (lan.startsWith("http")) lan.trimEnd('/') else "http://$lan"
                val lanJwt = runCatching {
                    withTimeout(4000) { App.api(lanUrl).auth.login(LoginRequest(username, dev.ccPass ?: "")) }
                }.getOrNull()?.token
                if (lanJwt != null) {
                    s = lanUrl; t = lanJwt; r = null
                    App.tokenHolder.token = lanJwt
                    App.tokenHolder.relayToken = null
                    _connected.value = true
                }
            }
            if (t == null && r == null) return@launch
            serverUrl = s
            runCatching {
                val resp = App.api(s).project.messages(sessionId, limit = 80)
                android.util.Log.i("planrla", "history: ${resp.messages.size} msgs on $s sid=$sessionId")
                if (resp.messages.isNotEmpty()) loadHistory(resp.messages)
            }.onFailure { android.util.Log.e("planrla", "history load FAILED sid=$sessionId", it) }
            launch {
                runCatching {
                    val c = App.api(s).command.list(CommandListRequest(provider = sessionProvider ?: "claude", sessionId = sessionId))
                    _commands.value = (c.builtIn + c.custom).filterNot { it.name.isNullOrBlank() }
                }
            }
            if (!projectId.isNullOrBlank()) {
                launch { loadGit(s) }
                launch { loadSessions(s) }
            }
            val ch = Channel<ChatEvent>(Channel.UNLIMITED)
            val sock = App.chatSocket()
            socket = sock
            sock.connect(s, t, r, ch)
            launch { for (ev in ch) handle(ev) }
        }
    }

    /** Map REST history (NormalizedMessage list) into ChatItems. Unlike the live
     *  stream handler, this includes user messages (history has no local echo). */
    private fun loadHistory(messages: List<NormalizedMessage>) {
        val out = mutableListOf<ChatItem>()
        for (m in messages.sortedBy { it.timestamp ?: "" }) {
            val kindStr = m.typeField ?: m.kind?.name ?: continue
            val text = m.content ?: m.text
            val t = parseTime(m.timestamp)
            when (kindStr) {
                "text" -> {
                    if (m.role == "user") out.add(ChatItem.User(text ?: "", t))
                    else {
                        if (sessionProvider == null) sessionProvider = m.provider
                        val a = ChatItem.Assistant(time = t, provider = m.provider)
                        a.text.value = text ?: ""
                        a.done.value = true
                        out.add(a)
                    }
                }
                "thinking" -> if (!text.isNullOrBlank()) out.add(ChatItem.Thinking(text, t))
                "tool_use" -> out.add(ChatItem.ToolCard(m.toolName, m.toolInput?.toString() ?: "", m.toolId, time = t))
                "tool_result" -> {
                    val card = out.lastOrNull {
                        it is ChatItem.ToolCard && (m.toolId == null || it.toolId == m.toolId)
                    } as? ChatItem.ToolCard
                    if (card != null) {
                        card.result.value = m.toolResult?.content
                        card.isError.value = m.toolResult?.isError ?: false
                    }
                }
            }
        }
        _items.value = out
    }

    private fun handle(ev: ChatEvent) {
        when (ev) {
            is ChatEvent.Connected -> {
                // WS (re)opened: re-attach to the current session's live run so a background
                // run survives disconnects / switching back. chat.send auto-attaches the sender,
                // so this is only needed for reconnect / opening an already-running session.
                _connected.value = true
                currentSessionId?.let { sid -> socket?.sendSubscribe(sid) }
            }
            is ChatEvent.ChatSubscribed -> {
                _connected.value = true
                _working.value = ev.isProcessing
                if (ev.pendingPermissions.isNotEmpty()) {
                    _perms.value = ev.pendingPermissions.map { PermissionReq(it.requestId, it.toolName, it.input?.toString()) }
                }
            }
            is ChatEvent.ProtocolError -> {
                _working.value = false
                _items.value = _items.value + ChatItem.Sys("⚠ ${ev.code}: ${ev.error}")
            }
            is ChatEvent.Other -> _connected.value = true
            is ChatEvent.TextDelta -> { if (sessionProvider == null) sessionProvider = "claude"; appendDelta(ev.text) }
            is ChatEvent.TextMessage -> {
                if (ev.role == "user") return
                val last = _items.value.lastOrNull() as? ChatItem.Assistant
                if (last != null && !last.done.value && ev.text.isNotEmpty()) last.text.value = ev.text
                else appendDelta(ev.text)
            }
            is ChatEvent.Thinking -> _items.value = _items.value + ChatItem.Thinking(ev.text, System.currentTimeMillis())
            is ChatEvent.ToolUse -> _items.value =
                _items.value + ChatItem.ToolCard(ev.toolName, ev.input?.toString() ?: "", ev.toolId, time = System.currentTimeMillis())
            is ChatEvent.ToolResultEv -> {
                val card = _items.value.asReversed()
                    .firstOrNull { it is ChatItem.ToolCard && (ev.toolId == null || it.toolId == ev.toolId) }
                    as? ChatItem.ToolCard
                card?.let {
                    it.result.value = ev.content
                    it.isError.value = ev.isError
                }
            }
            is ChatEvent.PermissionRequest -> _perms.value =
                _perms.value + PermissionReq(ev.requestId, ev.toolName, ev.input?.toString())
            is ChatEvent.PermissionCancelled -> _perms.value =
                _perms.value.filterNot { it.requestId == ev.requestId }
            ChatEvent.StreamEnd -> {
                (_items.value.lastOrNull { it is ChatItem.Assistant } as? ChatItem.Assistant)?.done?.value = true
                _working.value = false
            }
            ChatEvent.Complete -> {
                _working.value = false
                notifyRunCompleteIfBackground()
            }
            is ChatEvent.TokenBudgetEv -> _tokenBudget.value =
                TokenBudget(ev.used, ev.total, ev.input, ev.output)
            is ChatEvent.ErrorEv -> _items.value = _items.value + ChatItem.Sys("⚠ ${ev.message}")
            is ChatEvent.SessionCreated -> ev.sessionId.takeIf { it.isNotBlank() }?.let { currentSessionId = it }
        }
    }

    private fun appendDelta(text: String) {
        val last = _items.value.lastOrNull() as? ChatItem.Assistant
        if (last != null && !last.done.value) {
            last.text.value += text
        } else {
            _items.value = _items.value + ChatItem.Assistant(time = System.currentTimeMillis(), provider = sessionProvider).apply { this.text.value = text }
        }
    }

    /** Post a local "Claude 已完成" notification only when the app is backgrounded
     *  (ProcessLifecycleOwner → App.isForeground). Foreground runs stay silent. */
    private fun notifyRunCompleteIfBackground() {
        if (App.isForeground) return
        val ctx = App.appContext
        val n = NotificationCompat.Builder(ctx, "planrla_run")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(providerDisplayName(sessionProvider))
            .setContentText("运行完成")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        // isForeground gate is the real guard; permission denial throws SecurityException
        // which we swallow (best-effort — won't crash the run handler).
        runCatching {
            NotificationManagerCompat.from(ctx).notify(currentSessionId.hashCode(), n)
        }
    }

    fun send(text: String) {
        val imgs = _images.value
        if (text.isBlank() && imgs.isEmpty()) return
        _items.value = _items.value + ChatItem.User(text.ifBlank { "📷 图片" }, System.currentTimeMillis())
        _images.value = emptyList()
        _working.value = true
        val sid = currentSessionId
        if (sid != null) {
            socket?.sendChat(sid, text, cwd, _permissionMode.value, imgs.map { it.dataUrl to it.name })
        } else {
            // chat.* requires a session row — create one via REST, then send.
            viewModelScope.launch {
                val s = serverUrl ?: return@launch
                runCatching {
                    val created = App.api(s).session.create(CreateSessionRequest(provider = sessionProvider ?: "claude", projectPath = cwd ?: projectId ?: ""))
                    currentSessionId = created.sessionId
                    socket?.sendChat(created.sessionId, text, cwd, _permissionMode.value, imgs.map { it.dataUrl to it.name })
                }.onFailure { e ->
                    _items.value = _items.value + ChatItem.Sys("⚠ 创建会话失败：${e.message ?: "未知错误"}")
                    _working.value = false
                }
            }
        }
    }

    fun abort() {
        currentSessionId?.let { socket?.sendAbort(it) }
        _working.value = false
    }

    fun cyclePermissionMode() {
        val idx = PERMISSION_MODES.indexOf(_permissionMode.value)
        _permissionMode.value = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.size]
    }

    fun addImage(dataUrl: String, name: String) {
        _images.value = _images.value + AttachImage(dataUrl, name)
    }

    fun removeImage(index: Int) {
        _images.value = _images.value.filterIndexed { i, _ -> i != index }
    }

    fun respondPermission(requestId: String, allow: Boolean) {
        socket?.sendPermissionResponse(requestId, allow)
        _perms.value = _perms.value.filterNot { it.requestId == requestId }
    }

    private suspend fun loadGit(s: String) {
        val pid = projectId ?: return
        runCatching { App.api(s).git.status(pid) }
            .onSuccess {
                _branch.value = it.branch
                _gitStatus.value = it
            }
        loadRemoteStatus(s)
    }

    private suspend fun loadSessions(s: String) {
        val pid = projectId ?: return
        runCatching { App.api(s).project.sessions(pid).sessions }
            .onSuccess { _sessions.value = it }
    }

    fun openBranchPicker() {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching {
                val b = App.api(s).git.branches(pid)
                _branches.value = b.localBranches.ifEmpty { b.remoteBranches }
            }
            _branchPickerOpen.value = true
        }
    }

    fun closeBranchPicker() { _branchPickerOpen.value = false }

    fun checkout(branchName: String) {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).git.checkout(CheckoutRequest(pid, branchName)) }
                .onSuccess { loadGit(s) }
            _branchPickerOpen.value = false
        }
    }

    fun toggleStaged(file: String) {
        _staged.value = if (file in _staged.value) _staged.value - file else _staged.value + file
    }

    fun generateAndCommit(files: List<String>, messageOverride: String? = null) {
        val pid = projectId ?: return
        if (files.isEmpty()) return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _committing.value = true
            runCatching {
                val msg = messageOverride ?: App.api(s).git
                    .generateCommitMessage(GenerateCommitMessageRequest(pid, files)).message
                    ?: "update ${files.size} file(s)"
                App.api(s).git.commit(CommitRequest(pid, msg, files))
            }.onSuccess { loadGit(s); _staged.value = emptySet() }
            _committing.value = false
        }
    }

    fun openFileDiff(file: String) {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _fileDiff.value = file to null
            // Prefer line-level diff text; fall back to currentContent if empty/failed.
            val diffText = runCatching { App.api(s).git.diff(pid, file).string() }.getOrNull()
            if (!diffText.isNullOrBlank()) {
                _diff.value = file to diffText
            } else {
                runCatching { App.api(s).git.fileWithDiff(pid, file) }
                    .onSuccess { _fileDiff.value = file to it }
            }
        }
    }

    fun closeFileDiff() {
        _fileDiff.value = null
        _diff.value = null
    }

    /** Execute a slash command server-side; on success forward the returned output/result text
     *  into the chat as a user message. Falls back to sending the raw command name on failure. */
    fun runCommand(name: String) {
        val cmd = name.trim()
        if (cmd.isEmpty()) return
        viewModelScope.launch {
            val s = serverUrl ?: return@launch
            runCatching {
                App.api(s).command.execute(
                    CommandExecuteRequest(command = cmd, provider = sessionProvider ?: "claude", sessionId = currentSessionId)
                )
            }.onSuccess { r ->
                val out = r.output?.takeIf { it.isNotBlank() }
                    ?: r.result?.takeIf { it.isNotBlank() }
                send(out ?: cmd)
            }.onFailure { send(cmd) }
        }
    }

    /** Re-send the last user message (regenerate the assistant reply). */
    fun regenerate() {
        val lastUser = _items.value.lastOrNull { it is ChatItem.User } as? ChatItem.User ?: return
        send(lastUser.text)
    }

    /** Run a git remote op (pull/push/fetch). Uses _gitBusy to guard against double-clicks. */
    fun gitRemote(op: String) {
        val pid = projectId ?: return
        if (_gitBusy.value) return
        viewModelScope.launch {
            val s = serverUrl ?: App.resolveBaseUrl() ?: return@launch
            _gitBusy.value = true
            runCatching {
                val r = when (op) {
                    "pull" -> App.api(s).git.pull(GitRemoteRequest(pid))
                    "push" -> App.api(s).git.push(GitRemoteRequest(pid))
                    else -> App.api(s).git.fetch(GitRemoteRequest(pid))
                }
                val msg = r.output?.takeIf { it.isNotBlank() }
                    ?: if (r.success != false) "${gitOpLabel(op)}完成" else (r.error ?: "${gitOpLabel(op)}失败")
                _items.value = _items.value + ChatItem.Sys("Git ${gitOpLabel(op)}：$msg")
            }.onFailure { _items.value = _items.value + ChatItem.Sys("⚠ Git ${gitOpLabel(op)}失败：${it.message ?: "未知错误"}") }
            _gitBusy.value = false
        }
    }

    /** Discard local changes to a single file (git checkout -- file). Refreshes status on success. */
    fun discard(file: String) {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = serverUrl ?: App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).git.discard(DiscardRequest(pid, file)) }
                .onSuccess {
                    _items.value = _items.value + ChatItem.Sys("Git 放弃更改：${it.output?.takeIf { o -> o.isNotBlank() } ?: file}")
                    loadGit(s)
                }
                .onFailure { _items.value = _items.value + ChatItem.Sys("⚠ Git 放弃更改失败：${it.message ?: "未知错误"}") }
        }
    }

    /** Fetch ahead/behind summary as a short string. Parses common {ahead,behind} JSON, falls back to raw text. */
    fun loadRemoteStatus(sOverride: String? = null) {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = sOverride ?: serverUrl ?: App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).git.remoteStatus(pid).string() }
                .onSuccess { raw ->
                    _remoteStatus.value = runCatching {
                        val o = NetworkModule.json.parseToJsonElement(raw).jsonObject
                        val ahead = o["ahead"]?.jsonPrimitive?.intOrNull
                        val behind = o["behind"]?.jsonPrimitive?.intOrNull
                        when {
                            ahead != null && behind != null && (ahead > 0 || behind > 0) -> "↑$ahead ↓$behind"
                            ahead != null && behind != null -> "已是最新"
                            else -> raw.take(40)
                        }
                    }.getOrNull() ?: raw.take(40)
                }
        }
    }

    /** Load recent commit log (limit 50) and open the history dialog. */
    fun openCommits() {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = serverUrl ?: App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).git.commits(pid, 50).string() }
                .onSuccess { raw ->
                    _commits.value = runCatching {
                        val arr = NetworkModule.json.parseToJsonElement(raw)
                        val list = mutableListOf<CommitInfo>()
                        if (arr is JsonArray) {
                            arr.forEach { el ->
                                val o = el as? JsonObject ?: return@forEach
                                list.add(CommitInfo(
                                    hash = (o["hash"] as? JsonPrimitive)?.contentOrNull,
                                    message = (o["message"] as? JsonPrimitive)?.contentOrNull,
                                    author = (o["author"] as? JsonPrimitive)?.contentOrNull,
                                    email = (o["email"] as? JsonPrimitive)?.contentOrNull,
                                    date = (o["date"] as? JsonPrimitive)?.contentOrNull,
                                ))
                            }
                        }
                        list
                    }.getOrNull()
                    _commitsOpen.value = true
                }
                .onFailure { _items.value = _items.value + ChatItem.Sys("⚠ Git 历史加载失败：${it.message ?: "未知错误"}") }
        }
    }

    fun closeCommits() { _commitsOpen.value = false }

    /** Delete a branch server-side, then refresh the branch list. */
    fun deleteBranch(name: String) {
        val pid = projectId ?: return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).git.deleteBranch(DeleteBranchRequest(pid, name)) }
                .onSuccess {
                    _items.value = _items.value + ChatItem.Sys("Git 删除分支：${it.output?.takeIf { o -> o.isNotBlank() } ?: name}")
                    runCatching {
                        val b = App.api(s).git.branches(pid)
                        _branches.value = b.localBranches.ifEmpty { b.remoteBranches }
                    }
                }
                .onFailure { _items.value = _items.value + ChatItem.Sys("⚠ 删除分支失败：${it.message ?: "未知错误"}") }
            _branchPickerOpen.value = true
        }
    }

    /**
     * Update TokenStore + tokenHolder to the given device. Does NOT reconnect in place —
     * switching devices connects to a different planrla instance, so the caller navigates
     * to a fresh ChatScreen (chat/new) whose start() connects to the new current device.
     */
    suspend fun applyDevice(id: String): Boolean {
        App.tokenStore.setCurrentDevice(id)
        val dev = App.tokenStore.currentDevice() ?: return false
        return runCatching {
            App.applyDeviceSelection(dev)
        }.onFailure { error ->
            val message = when {
                error.message?.contains("401") == true -> "直接连接登录失败：账号或密码不正确"
                else -> "切换桌面端失败：${error.message ?: "未知错误"}"
            }
            _items.value = _items.value + ChatItem.Sys("⚠ $message")
            android.util.Log.e("planrla", "applyDevice failed id=$id", error)
        }.isSuccess
    }

    fun refreshDevices() {
        viewModelScope.launch {
            val s = App.tokenStore.serverUrlSync() ?: return@launch
            val jwt = App.tokenStore.accountJwtSync() ?: return@launch
            runCatching { App.api(s).account.devices("Bearer $jwt").devices }
                .onSuccess { list ->
                    val existing = App.tokenStore.devicesSync().associateBy { it.id }
                    App.tokenStore.setDevices(list.map { d ->
                        val ex = existing[d.id]
                        Device(d.id, d.name.ifBlank { App.appContext.getString(R.string.connect_default_device_name) }, d.token, ex?.lan, ex?.ccUser, ex?.ccPass)
                    })
                }
        }
    }

    override fun onCleared() {
        socket?.close()
    }

    companion object {
        fun factory(sessionId: String, cwd: String?, projectId: String?) = viewModelFactory {
            initializer { ChatViewModel(sessionId, cwd, projectId) }
        }
    }

    private fun gitOpLabel(op: String): String = when (op) {
        "pull" -> "拉取"
        "push" -> "推送"
        "fetch" -> "获取"
        else -> op
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    sessionId: String,
    cwd: String?,
    title: String? = null,
    projectId: String? = null,
    onSelectSession: (projectId: String, cwd: String?, session: SessionInfo) -> Unit = { _, _, _ -> },
    onNewSession: (projectId: String, cwd: String?) -> Unit = { _, _ -> },
    onSwitchDevice: () -> Unit = {},
    onLogout: () -> Unit = {},
    vm: ChatViewModel = viewModel(factory = ChatViewModel.factory(sessionId, cwd, projectId)),
    projectsVm: ProjectsViewModel = viewModel(factory = ProjectsViewModel.Factory),
) {
    val items by vm.items.collectAsStateWithLifecycle()
    val perms by vm.perms.collectAsStateWithLifecycle()
    val connected by vm.connected.collectAsStateWithLifecycle()
    val working by vm.working.collectAsStateWithLifecycle()
    val branch by vm.branch.collectAsStateWithLifecycle()
    val branches by vm.branches.collectAsStateWithLifecycle()
    val branchPickerOpen by vm.branchPickerOpen.collectAsStateWithLifecycle()
    val currentProvider by vm.sessionProviderFlow.collectAsStateWithLifecycle()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var viewMode by rememberSaveable { mutableStateOf(0) } // 0=Chat 1=Shell 2=Files 3=Source Control
    var showSettings by remember { mutableStateOf(false) }
    var showExtensions by remember { mutableStateOf(false) }
    var showFullSettings by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf<String?>(null) }
    var token by remember { mutableStateOf<String?>(null) }
    var relayToken by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        vm.start()
        serverUrl = App.tokenStore.serverUrlSync()
        token = App.tokenStore.tokenSync()
        relayToken = App.tokenStore.relayTokenSync()
    }
    LaunchedEffect(sessionId) { viewMode = 0 }
    val devices by App.tokenStore.devices.collectAsStateWithLifecycle(initialValue = emptyList())
    val currentDeviceId by App.tokenStore.currentDeviceId.collectAsStateWithLifecycle(initialValue = null)
    val currentDevice = devices.firstOrNull { it.id == currentDeviceId }
    var showDeviceSheet by remember { mutableStateOf(false) }
    var showAddDevice by remember { mutableStateOf(false) }
    var editDeviceId by remember { mutableStateOf<String?>(null) }
    var prevWorking by remember { mutableStateOf(false) }
    LaunchedEffect(working) {
        // claude just finished (working true→false) while the drawer is open → mark conversation unread
        if (prevWorking && !working && drawerState.currentValue == DrawerValue.Open) {
            val sid = vm.currentSessionId ?: sessionId
            if (sid != "new" && sid.isNotBlank()) App.markUnread(sid)
        }
        prevWorking = working
    }

    val projectName = remember(cwd) {
        cwd?.trimEnd('\\', '/')?.substringAfterLast('\\')?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() } ?: "planrla"
    }

    perms.firstOrNull()?.let { req ->
        AlertDialog(
            onDismissRequest = { vm.respondPermission(req.requestId, false) },
            title = { Text(stringResource(R.string.chat_permission_required)) },
            text = {
                Column {
                    Text(stringResource(R.string.chat_permission_tool, req.toolName ?: stringResource(R.string.chat_unknown)), fontWeight = FontWeight.SemiBold)
                    req.input?.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.padding(top = 4.dp))
                        Text(it, fontFamily = FontFamily.Monospace, maxLines = 6)
                    }
                }
            },
            confirmButton = { Button({ vm.respondPermission(req.requestId, true) }) { Text(stringResource(R.string.chat_allow)) } },
            dismissButton = { OutlinedButton({ vm.respondPermission(req.requestId, false) }) { Text(stringResource(R.string.chat_deny)) } }
        )
    }

    if (branchPickerOpen) {
        AlertDialog(
            onDismissRequest = { vm.closeBranchPicker() },
            title = { Text(stringResource(R.string.chat_switch_branch)) },
            text = {
                Column {
                    if (branches.isEmpty()) {
                        Text(stringResource(R.string.chat_no_branches), style = MaterialTheme.typography.bodySmall)
                    }
                    branches.forEach { b ->
                        Row(
                            Modifier.fillMaxWidth().clickable { vm.checkout(b) }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                if (b == branch) "● " else "○ ",
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                b,
                                color = if (b == branch) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            if (b != branch) {
                                Text(
                                    "🗑",
                                    Modifier.clickable { vm.deleteBranch(b) }.padding(horizontal = 6.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton({ vm.closeBranchPicker() }) { Text(stringResource(R.string.chat_close)) } },
        )
    }

    val commitsOpen by vm.commitsOpen.collectAsStateWithLifecycle()
    val commitsLog by vm.commits.collectAsStateWithLifecycle()
    if (commitsOpen) {
        AlertDialog(
            onDismissRequest = { vm.closeCommits() },
            title = { Text(stringResource(R.string.chat_commit_history)) },
            text = {
                val log = commitsLog
                if (log == null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.settings_loading), style = MaterialTheme.typography.bodySmall)
                    }
                } else if (log.isEmpty()) {
                    Text(stringResource(R.string.chat_no_commits), style = MaterialTheme.typography.bodySmall)
                } else {
                    Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 420.dp)) {
                        log.forEach { c ->
                            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        (c.hash?.take(7) ?: "•"),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        fontFamily = FontFamily.Monospace,
                                    )
                                    c.date?.takeIf { it.isNotBlank() }?.let {
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            it.take(10),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                c.message?.takeIf { it.isNotBlank() }?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 3,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                c.author?.takeIf { it.isNotBlank() }?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton({ vm.closeCommits() }) { Text(stringResource(R.string.chat_close)) } },
        )
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            Sidebar(
                vm = projectsVm,
                currentSessionId = sessionId,
                onSession = { pid, c, s -> scope.launch { drawerState.close() }; App.markRead(s.id); onSelectSession(pid, c, s) },
                onNewSession = { pid, c -> scope.launch { drawerState.close() }; onNewSession(pid, c) },
                onClose = { scope.launch { drawerState.close() } },
                onOpenSettings = { scope.launch { drawerState.close() }; showSettings = true },
            )
        },
    ) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
                navigationIcon = {
                    IconButton(onClick = { scope.launch { drawerState.open() } }) {
                        Icon(Icons.Filled.Menu, contentDescription = stringResource(R.string.chat_conversations))
                    }
                },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ProviderAvatarHeader(32, currentProvider)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                title ?: if (sessionId == "new") stringResource(R.string.chat_new_session_title) else sessionId.take(8),
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                            if (currentDevice != null) {
                                Row(
                                    Modifier.clip(RoundedCornerShape(6.dp))
                                        .clickable { showDeviceSheet = true }
                                        .padding(vertical = 1.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("🖥", style = MaterialTheme.typography.labelSmall)
                                    Spacer(Modifier.width(4.dp))
                                    Text(
                                        currentDevice.name,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        maxLines = 1,
                                    )
                                    Text(" ▾", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                }
                            } else {
                                Text(
                                    projectName,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                },
                actions = {
                    HeaderTabSwitcher(viewMode) { viewMode = it }
                }
            )
        },
    ) { pad ->
        when (viewMode) {
            1 -> {
                val s = serverUrl; val t = relayToken ?: token
                if (s != null && t != null) ShellView(s, t, cwd, Modifier.fillMaxSize().padding(pad))
                else ShellLoading(Modifier.fillMaxSize().padding(pad))
            }
            2 -> FilesPane(projectId, Modifier.fillMaxSize().padding(pad))
            3 -> SourceView(branch, vm, Modifier.fillMaxSize().padding(pad))
            else -> Column(Modifier.fillMaxSize().padding(pad)) {
                if (!connected) {
                    Text(
                        stringResource(R.string.chat_connecting_session),
                        Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (items.isEmpty()) {
                    Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            ProviderAvatarHeader(48, currentProvider)
                            Spacer(Modifier.height(16.dp))
                            Text(
                                if (sessionId == "new") stringResource(R.string.chat_choose_assistant) else stringResource(R.string.chat_no_messages),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                if (sessionId == "new")
                                    stringResource(R.string.chat_select_provider)
                                else stringResource(R.string.chat_start_conversation),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                            if (sessionId == "new") {
                                Spacer(Modifier.height(20.dp))
                                // Provider card — matches web's Card with provider logo + name + model hint
                                // Provider card — tappable to show model selector (matches web Card + Dialog)
                                var showModelPicker by remember { mutableStateOf(false) }
                                Surface(
                                    Modifier.fillMaxWidth(0.85f)
                                        .clip(RoundedCornerShape(10.dp))
                                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f))
                                        .clickable { showModelPicker = true },
                                    shape = RoundedCornerShape(10.dp),
                                    color = MaterialTheme.colorScheme.surface,
                                ) {
                                    Row(
                                        Modifier.fillMaxWidth().padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        ProviderAvatarHeader(24, currentProvider)
                                        Spacer(Modifier.width(8.dp))
                                        Column(Modifier.weight(1f)) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    providerDisplayName(currentProvider),
                                                    style = MaterialTheme.typography.labelMedium,
                                                    fontWeight = FontWeight.SemiBold,
                                                    color = MaterialTheme.colorScheme.onSurface,
                                                )
                                                Text(
                                            stringResource(R.string.chat_model_default_suffix),
                                                    style = MaterialTheme.typography.labelMedium,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                            Text(
                                                stringResource(R.string.chat_model_change_hint),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                                    }
                                }
                                if (showModelPicker) {
                                    AlertDialog(
                                        onDismissRequest = { showModelPicker = false },
                                        title = { Text(stringResource(R.string.chat_choose_model)) },
                                        text = {
                                            Column {
                                                listOf(
                                                    stringResource(R.string.chat_model_claude_default),
                                                    stringResource(R.string.chat_model_claude_sonnet),
                                                    stringResource(R.string.chat_model_claude_opus),
                                                ).forEach { model ->
                                                    Row(
                                                        Modifier.fillMaxWidth()
                                                            .clip(RoundedCornerShape(8.dp))
                                                            .clickable { showModelPicker = false }
                                                            .padding(12.dp),
                                                        verticalAlignment = Alignment.CenterVertically,
                                                    ) {
                                                        Text(model, style = MaterialTheme.typography.bodyMedium)
                                                    }
                                                }
                                            }
                                        },
                                        confirmButton = { TextButton(onClick = { showModelPicker = false }) { Text(stringResource(R.string.settings_cancel)) } },
                                    )
                                }
                            }
                        }
                    }
                } else {
                    MessageList(items, working, vm::regenerate, Modifier.weight(1f))
                }
                if (working) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(
                            Modifier.size(12.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            stringResource(R.string.chat_working),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                ComposerBar(vm)
            }
        }
    }
    }
    if (showSettings) QuickSettingsPanel(
        onDismiss = { showSettings = false },
        onLogout = onLogout,
        onOpenExtensions = { showSettings = false; showExtensions = true },
        onOpenSettings = { showSettings = false; showFullSettings = true },
    )
    if (showExtensions) ExtensionsPanel(onDismiss = { showExtensions = false })
    if (showFullSettings) SettingsPanel(onDismiss = { showFullSettings = false })
    if (showDeviceSheet) {
        DeviceSwitcherSheet(
            devices = devices,
            currentDeviceId = currentDeviceId,
            onSelect = { id ->
                showDeviceSheet = false
                scope.launch { if (vm.applyDevice(id)) onSwitchDevice() }
            },
            onAdd = { showDeviceSheet = false; showAddDevice = true },
            onRefresh = { vm.refreshDevices() },
            onEdit = { showDeviceSheet = false; editDeviceId = it },
            onDismiss = { showDeviceSheet = false },
        )
    }
    if (showAddDevice) {
        val defaultDeviceName = stringResource(R.string.connect_default_device_name)
        AddDeviceDialog(
            onConfirm = { name, deviceToken, lan, ccUser, ccPass ->
                val normalizedLan = normalizeHostInput(lan)
                val deviceRelayToken = deviceToken.trim()
                val id = deviceRelayToken.ifBlank { normalizedLan }
                scope.launch {
                    App.tokenStore.upsertDevice(Device(
                        id = id,
                        name = name.trim().ifBlank { normalizedLan.ifBlank { defaultDeviceName } },
                        token = deviceRelayToken,
                        lan = normalizedLan.ifBlank { null },
                        ccUser = ccUser.trim().ifBlank { null },
                        ccPass = ccPass.ifBlank { null },
                    ))
                    if (vm.applyDevice(id)) onSwitchDevice()
                }
                showAddDevice = false
            },
            onDismiss = { showAddDevice = false },
        )
    }
    editDeviceId?.let { eid ->
        val dev = devices.firstOrNull { it.id == eid }
        if (dev != null) {
            EditLanDialog(
                device = dev,
                onSave = { lan, ccUser, ccPass ->
                    scope.launch {
                        App.tokenStore.upsertDevice(dev.copy(
                            lan = lan.trim().ifBlank { null },
                            ccUser = ccUser.trim().ifBlank { null },
                            ccPass = ccPass.ifBlank { null },
                        ))
                    }
                    editDeviceId = null
                },
                onDismiss = { editDeviceId = null },
            )
        }
    }
}

@Composable
private fun MessageList(
    items: List<ChatItem>,
    working: Boolean,
    onRegenerate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = rememberLazyListState()
    LaunchedEffect(items.size) {
        if (App.settings.autoScroll && items.isNotEmpty()) state.animateScrollToItem(items.size - 1)
    }
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        state = state,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp),
    ) {
        itemsIndexed(items) { index, item ->
            ChatRow(item, items.getOrNull(index - 1))
        }
        // Regenerate button: show after the last assistant reply when idle.
        val last = items.lastOrNull()
        item {
            if (!working && last is ChatItem.Assistant && last.done.value && last.text.value.isNotBlank()) {
                TextButton(
                    onClick = onRegenerate,
                    modifier = Modifier.padding(start = 12.dp, top = 2.dp, bottom = 4.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                ) {
                    Text(stringResource(R.string.chat_regenerate), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun ChatRow(item: ChatItem, prev: ChatItem?) {
    when (item) {
        is ChatItem.User -> UserBubble(item.text, item.time)
        is ChatItem.Assistant -> {
            val text by item.text.collectAsStateWithLifecycle()
            val done by item.done.collectAsStateWithLifecycle()
            if (text.isNotEmpty()) AssistantBlock(if (done) text else "$text▌", prev !is ChatItem.Assistant, item.time, done, item.provider)
        }
        is ChatItem.Thinking -> { if (App.settings.showThinking) ThinkingBlock(item.text) }
        is ChatItem.ToolCard -> ToolCardRow(item)
        is ChatItem.Sys -> Text(
            "⚠ ${item.text}",
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            color = MaterialTheme.colorScheme.error
        )
    }
}

/** User message: blue bubble, right-aligned (bg-blue-600, rounded-2xl rounded-br-md). */
@Composable
private fun UserBubble(text: String, time: Long) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.End
    ) {
        Surface(
            color = UserBubbleBlue,
            contentColor = Color.White,
            shape = RoundedCornerShape(16.dp, 16.dp, 6.dp, 16.dp),
            tonalElevation = 0.dp,
            shadowElevation = 1.dp,
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            Text(
                text,
                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        MessageMeta(time, text, alignEnd = true)
    }
}

/** Assistant message: avatar + provider header (first of group only) then plain markdown-style text (no bubble). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AssistantBlock(text: String, showHeader: Boolean = true, time: Long = 0L, done: Boolean = true, provider: String? = null) {
    val context = LocalContext.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(8.dp))
            .combinedClickable(
                onClick = {},
                onLongClick = {
                    val cb = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    cb?.setPrimaryClip(ClipData.newPlainText("planrla", text))
                },
            )
    ) {
        if (showHeader) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProviderAvatarHeader(32, provider)
                Spacer(Modifier.width(10.dp))
                Text(
                    providerDisplayName(provider),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            Spacer(Modifier.height(8.dp))
        }
        MarkdownText(text, Modifier.fillMaxWidth())
        if (done) MessageMeta(time, text, alignEnd = false)
    }
}

@Composable
private fun MessageMeta(time: Long, copyContent: String, alignEnd: Boolean) {
    val context = LocalContext.current
    val clipboard = remember(copyContent) {
        context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? ClipboardManager
    }
    var copied by remember { mutableStateOf(false) }
    val timeStr = fmtTime(time)
    if (timeStr.isEmpty() && copyContent.isBlank()) return
    Row(
        Modifier.padding(top = 2.dp),
        horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (copyContent.isNotBlank()) {
            // Copy button — icon style like web's copy control (not just text)
            Row(
                Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .clickable {
                        clipboard?.setPrimaryClip(ClipData.newPlainText("planrla", copyContent))
                        copied = true
                    }
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (copied) "✓" else "⎘",
                    color = if (copied) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall,
                )
                Spacer(Modifier.width(3.dp))
                Text(
                    if (copied) stringResource(R.string.chat_copied) else stringResource(R.string.chat_copy),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (copied) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (timeStr.isNotEmpty()) Spacer(Modifier.width(6.dp))
        }
        if (timeStr.isNotEmpty()) {
            Text(
                timeStr,
                style = MaterialTheme.typography.labelSmall,
                color = if (alignEnd) UserTimestampBlue else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

/** Thinking: collapsible "Thought for a few seconds" block. */
@Composable
private fun ThinkingBlock(text: String) {
    var expanded by remember { mutableStateOf(false) }
    val rotation by animateFloatAsState(if (expanded) 180f else 0f, label = "chevron")
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(
            Modifier.clickable { expanded = !expanded }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                Modifier.size(16.dp).graphicsLayer { rotationZ = rotation },
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                stringResource(R.string.chat_thought_few_seconds),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            Text(
                text,
                Modifier.padding(start = 12.dp, top = 16.dp).fillMaxWidth(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 20.sp,
            )
        }
    }
}

@Composable
private fun ToolCardRow(card: ChatItem.ToolCard) {
    var expanded by remember { mutableStateOf(App.settings.autoExpandTools) }
    val result by card.result.collectAsStateWithLifecycle()
    val isError by card.isError.collectAsStateWithLifecycle()
    val catColor = toolCategoryColor(card.toolName)
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(32.dp).clip(CircleShape).background(ToolAvatarGray),
                contentAlignment = Alignment.Center
            ) { Text("🔧", color = Color.White) }
            Spacer(Modifier.width(10.dp))
            Text(card.toolName ?: "tool", fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.width(6.dp))
            result?.let { ToolStatusBadge(isError) }
        }
        Spacer(Modifier.height(6.dp))
        Card(
            modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            shape = RoundedCornerShape(10.dp),
        ) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                // Left color bar (2dp, category-colored, matches web border-l-2)
                Box(Modifier.width(3.dp).fillMaxHeight().background(catColor))
                Column(Modifier.weight(1f).padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (expanded) stringResource(R.string.chat_tool_hide) else stringResource(R.string.chat_tool_show),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(if (expanded) "▼" else "▶", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (expanded && card.input.isNotBlank()) {
                        Text(
                            card.input,
                            Modifier.padding(top = 6.dp),
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 8,
                        )
                    }
                    result?.let {
                        Text(
                            "↳ $it",
                            Modifier.padding(top = 4.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 10,
                        )
                    }
                }
            }
        }
    }
}

/** Map tool name to a category color (mirrors web CollapsibleDisplay border-l-2 mapping). */
private fun toolCategoryColor(toolName: String?): Color = when {
    toolName == null -> Color(0xFF6B7280)
    toolName.contains("edit", true) || toolName.contains("write", true) -> Color(0xFFF59E0B) // amber-500
    toolName.contains("bash", true) || toolName.contains("exec", true) -> Color(0xFF22C55E)   // green-500
    toolName.contains("task", true) || toolName.contains("todo", true) -> Color(0xFF8B5CF6)   // violet-500
    toolName.contains("search", true) || toolName.contains("grep", true) -> Color(0xFF6B7280) // gray
    toolName.contains("read", true) || toolName.contains("list", true) -> Color(0xFF3B82F6)   // blue-500
    else -> Color(0xFF6B7280) // default gray
}

/** Colored status badge (Running/Completed/Error) — mirrors web ToolStatusBadge. */
@Composable
private fun ToolStatusBadge(isError: Boolean) {
    val (text, bg, fg) = if (isError) Triple(stringResource(R.string.chat_tool_error), Color(0x44EF4444), Color(0xFFFCA5A5))
                         else Triple(stringResource(R.string.chat_tool_ok), Color(0x4422C55E), Color(0xFF86EFAC))
    Box(
        Modifier.clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 6.dp, vertical = 1.dp)
    ) {
        Text(text, fontSize = 10.sp, fontWeight = FontWeight.Medium, color = fg)
    }
}

/** Markdown rendering — splits code blocks from prose, renders code blocks with
 *  dark bg + language label + copy button (matches web's SyntaxHighlighter + copy). */
@Composable
private fun MarkdownText(content: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val parts = remember(content) { splitMarkdownParts(content) }
    Column(modifier) {
        parts.forEach { part ->
            when (part) {
                is MdPart.Code -> CodeBlock(part.language, part.code, context)
                is MdPart.Table -> MarkdownTable(part.headers, part.rows)
                is MdPart.Text -> Markdown(
                    content = part.content,
                    modifier = Modifier.fillMaxWidth(),
                    colors = markdownColor(
                        text = MaterialTheme.colorScheme.onSurfaceVariant,
                        codeText = MaterialTheme.colorScheme.onSurface,
                        codeBackground = Color(0xFF1E1E2E),
                    ),
                    typography = markdownTypography(
                        text = MaterialTheme.typography.bodyMedium,
                        code = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        h1 = MaterialTheme.typography.titleLarge.copy(fontSize = 24.sp, fontWeight = FontWeight.SemiBold),
                        h2 = MaterialTheme.typography.titleMedium.copy(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
                        h3 = MaterialTheme.typography.titleSmall.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
                        h4 = MaterialTheme.typography.titleSmall.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
                        h5 = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        h6 = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                        quote = MaterialTheme.typography.bodyMedium,
                        paragraph = MaterialTheme.typography.bodyMedium,
                        ordered = MaterialTheme.typography.bodyMedium,
                        bullet = MaterialTheme.typography.bodyMedium,
                        list = MaterialTheme.typography.bodyMedium,
                    ),
                )
            }
        }
    }
}

private sealed class MdPart {
    data class Text(val content: String) : MdPart()
    data class Code(val language: String, val code: String) : MdPart()
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MdPart()
}

/** Split markdown into text/code/table parts. The markdown library does not render GFM
 *  pipe tables, so table blocks are parsed here and rendered by Compose. */
private fun splitMarkdownParts(content: String): List<MdPart> {
    val parts = mutableListOf<MdPart>()
    val regex = Regex("```(\\w*)\\n([\\s\\S]*?)```")
    var lastEnd = 0
    for (m in regex.findAll(content)) {
        if (m.range.first > lastEnd) {
            val text = content.substring(lastEnd, m.range.first).trim()
            if (text.isNotEmpty()) appendTextAndTables(parts, text)
        }
        val lang = m.groupValues[1].ifBlank { "text" }
        val code = m.groupValues[2].trimEnd('\n')
        parts.add(MdPart.Code(lang, code))
        lastEnd = m.range.last + 1
    }
    if (lastEnd < content.length) {
        val text = content.substring(lastEnd).trim()
        if (text.isNotEmpty()) appendTextAndTables(parts, text)
    }
    if (parts.isEmpty()) parts.add(MdPart.Text(content))
    return parts
}

private fun appendTextAndTables(parts: MutableList<MdPart>, text: String) {
    val lines = text.lines()
    val buffer = mutableListOf<String>()
    fun flushText() {
        val chunk = buffer.joinToString("\n").trim()
        if (chunk.isNotEmpty()) parts.add(MdPart.Text(chunk))
        buffer.clear()
    }

    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        if (i + 1 < lines.size && isPipeTableRow(line) && isPipeTableSeparator(lines[i + 1])) {
            val headers = parsePipeTableRow(line)
            val rows = mutableListOf<List<String>>()
            i += 2
            while (i < lines.size && isPipeTableRow(lines[i])) {
                rows.add(normalizeTableRow(parsePipeTableRow(lines[i]), headers.size))
                i++
            }
            if (headers.size >= 2 && rows.isNotEmpty()) {
                flushText()
                parts.add(MdPart.Table(headers, rows))
            } else {
                buffer.add(line)
            }
        } else {
            buffer.add(line)
            i++
        }
    }
    flushText()
}

private fun isPipeTableRow(line: String): Boolean {
    val trimmed = line.trim()
    return trimmed.contains("|") && parsePipeTableRow(trimmed).size >= 2
}

private fun isPipeTableSeparator(line: String): Boolean {
    val cells = parsePipeTableRow(line)
    return cells.size >= 2 && cells.all { it.matches(Regex(":?-{3,}:?")) }
}

private fun parsePipeTableRow(line: String): List<String> =
    line.trim().trim('|').split("|").map { it.trim() }

private fun normalizeTableRow(row: List<String>, size: Int): List<String> =
    when {
        row.size == size -> row
        row.size > size -> row.take(size)
        else -> row + List(size - row.size) { "" }
    }

@Composable
private fun MarkdownTable(headers: List<String>, rows: List<List<String>>) {
    val border = MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
    val headerBg = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    val cellBg = MaterialTheme.colorScheme.surface.copy(alpha = 0.35f)
    val widths = remember(headers) {
        headers.mapIndexed { index, _ ->
            when {
                headers.size == 2 && index == 0 -> 156.dp
                headers.size == 2 -> 560.dp
                else -> 180.dp
            }
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .horizontalScroll(rememberScrollState())
    ) {
        MarkdownTableRow(headers, widths, headerBg, border, header = true)
        rows.forEach { row ->
            MarkdownTableRow(normalizeTableRow(row, headers.size), widths, cellBg, border, header = false)
        }
    }
}

@Composable
private fun MarkdownTableRow(
    cells: List<String>,
    widths: List<androidx.compose.ui.unit.Dp>,
    bg: Color,
    border: Color,
    header: Boolean,
) {
    Row(Modifier.background(bg)) {
        cells.forEachIndexed { index, cell ->
            Box(
                Modifier
                    .width(widths.getOrElse(index) { 180.dp })
                    .border(0.5.dp, border)
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                MarkdownInlineText(cell, header)
            }
        }
    }
}

@Composable
private fun MarkdownInlineText(text: String, header: Boolean) {
    val codeBg = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
    val annotated = remember(text, codeBg) {
        buildAnnotatedString {
            val regex = Regex("`([^`]+)`")
            var last = 0
            regex.findAll(text).forEach { match ->
                append(text.substring(last, match.range.first))
                withStyle(
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        background = codeBg,
                    )
                ) {
                    append(match.groupValues[1])
                }
                last = match.range.last + 1
            }
            append(text.substring(last))
        }
    }
    Text(
        annotated,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = if (header) MaterialTheme.typography.labelMedium else MaterialTheme.typography.bodySmall,
        fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
    )
}

/** Dark code block with language label + copy button + regex-based syntax highlighting
 *  (approximates web Prism/oneDark — keywords purple, strings green, comments gray, numbers orange). */
@Composable
private fun CodeBlock(language: String, code: String, context: android.content.Context) {
    var copied by remember { mutableStateOf(false) }
    val highlighted = remember(code, language) { highlightCode(code, language) }
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        shape = RoundedCornerShape(8.dp),
        color = Color(0xFF1E1E2E),
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    language.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF6B7280),
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    if (copied) stringResource(R.string.chat_code_copied) else stringResource(R.string.chat_copy),
                    Modifier.clip(RoundedCornerShape(4.dp))
                        .clickable {
                            val cb = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? ClipboardManager
                            cb?.setPrimaryClip(ClipData.newPlainText("code", code))
                            copied = true
                        }
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (copied) Color(0xFF86EFAC) else Color(0xFF9CA3AF),
                )
            }
            // Highlighted code — AnnotatedString with oneDark-style colors
            Text(
                text = highlighted,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
                    .horizontalScroll(rememberScrollState()),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    color = Color(0xFFE5E7EB),
                ),
                softWrap = false,
            )
        }
    }
}

// oneDark-inspired syntax colors
private val CodeKeyword = Color(0xFFC678DD)   // purple
private val CodeString = Color(0xFF98C379)     // green
private val CodeComment = Color(0xFF7F848E)    // gray
private val CodeNumber = Color(0xFFD19A66)     // orange
private val CodeFunction = Color(0xFF61AFEF)   // blue
private val CodeType = Color(0xFFE5C07B)       // yellow
private val CodeDefault = Color(0xFFE5E7EB)    // light gray

private val LANG_KEYWORDS = mapOf(
    "kotlin" to setOf("fun", "val", "var", "class", "object", "interface", "if", "else", "when", "for", "while", "return", "import", "package", "override", "private", "public", "internal", "suspend", "companion", "init", "this", "super", "null", "true", "false", "is", "in", "as", "by", "lateinit", "const", "data", "sealed", "abstract", "open", "operator", "inline", "reified", "typealias", "where", "out", "in", "annotation", "crossinline", "noinline", "vararg", "break", "continue", "do", "throw", "try", "catch", "finally", "get", "set"),
    "java" to setOf("public", "private", "protected", "static", "final", "void", "class", "interface", "extends", "implements", "import", "package", "new", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "throw", "throws", "try", "catch", "finally", "this", "super", "null", "true", "false", "instanceof", "int", "long", "double", "float", "boolean", "char", "byte", "short", "synchronized", "volatile", "transient", "native", "abstract", "enum", "assert"),
    "javascript" to setOf("const", "let", "var", "function", "class", "extends", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "typeof", "instanceof", "new", "delete", "void", "this", "super", "null", "undefined", "true", "false", "async", "await", "yield", "import", "export", "default", "from", "as", "try", "catch", "finally", "throw", "in", "of"),
    "typescript" to setOf("const", "let", "var", "function", "class", "interface", "type", "extends", "implements", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "typeof", "instanceof", "new", "delete", "void", "this", "super", "null", "undefined", "true", "false", "async", "await", "yield", "import", "export", "default", "from", "as", "try", "catch", "finally", "throw", "in", "of", "enum", "namespace", "declare", "readonly", "public", "private", "protected", "static", "abstract", "get", "set"),
    "python" to setOf("def", "class", "if", "elif", "else", "for", "while", "return", "import", "from", "as", "try", "except", "finally", "raise", "with", "pass", "break", "continue", "lambda", "yield", "global", "nonlocal", "assert", "del", "in", "is", "not", "and", "or", "None", "True", "False", "self", "cls", "async", "await"),
    "bash" to setOf("if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "echo", "export", "local", "readonly", "source", "cd", "pwd", "ls", "cat", "grep", "sed", "awk", "mkdir", "rm", "cp", "mv", "chmod", "chown", "sudo", "apt", "npm", "node", "python", "pip"),
    "json" to setOf("true", "false", "null"),
    "sql" to setOf("SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "DROP", "ALTER", "INDEX", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AS", "AND", "OR", "NOT", "NULL", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "INTO", "VALUES", "SET", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "CONSTRAINT", "UNIQUE", "CHECK", "CASCADE", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION"),
)

/** Regex-based syntax highlighter — produces an AnnotatedString with oneDark-style spans. */
private fun highlightCode(code: String, language: String): androidx.compose.ui.text.AnnotatedString {
    val lang = language.lowercase()
    val keywords = LANG_KEYWORDS[lang] ?: LANG_KEYWORDS["javascript"]!!
    return androidx.compose.ui.text.buildAnnotatedString {
        // Simple approach: split by tokens while tracking position
        val tokenRegex = Regex(
            """(//[^\n]*|#[^\n]*|/\*[\s\S]*?\*/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|\b\w+\b|\s+|.)"""
        )
        var pos = 0
        for (match in tokenRegex.findAll(code)) {
            val token = match.value
            val color = when {
                token.startsWith("//") || token.startsWith("#") || token.startsWith("/*") -> CodeComment
                token.startsWith("\"") || token.startsWith("'") || token.startsWith("`") -> CodeString
                token.matches(Regex("""\d+\.?\d*""")) -> CodeNumber
                keywords.any { it.equals(token, ignoreCase = lang == "sql") } -> CodeKeyword
                else -> CodeDefault
            }
            pushStyle(androidx.compose.ui.text.SpanStyle(color = color))
            append(token)
            pop()
        }
    }
}

/** Claude logo: coral circle with the Anthropic-style 4-point burst. */
@Composable
private fun ClaudeAvatar(sizeDp: Int = 32) {
    Box(
        Modifier.size(sizeDp.dp).clip(CircleShape).background(ClaudeCoral),
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.size((sizeDp * 0.42f).dp)) {
            val w = this.size.width
            val h = this.size.height
            val path = Path().apply {
                moveTo(w * 0.5f, 0f)
                cubicTo(w * 0.56f, h * 0.38f, w * 0.62f, h * 0.44f, w, h * 0.5f)
                cubicTo(w * 0.62f, h * 0.56f, w * 0.56f, h * 0.62f, w * 0.5f, h)
                cubicTo(w * 0.44f, h * 0.62f, w * 0.38f, h * 0.56f, 0f, h * 0.5f)
                cubicTo(w * 0.38f, h * 0.44f, w * 0.44f, h * 0.38f, w * 0.5f, 0f)
                close()
            }
            drawPath(path, Color.White)
        }
    }
}

// ---- Provider-aware avatar + label for chat assistant header ----

private fun providerDisplayName(provider: String?): String = when (provider?.lowercase()) {
    "codex" -> "Codex"
    "cursor" -> "Cursor"
    "gemini" -> "Gemini"
    "opencode" -> "OpenCode"
    else -> "Claude"
}

@Composable
private fun permissionModeLabel(mode: String): String = when (mode) {
    "default" -> stringResource(R.string.permission_mode_default)
    "plan" -> stringResource(R.string.permission_mode_plan)
    "acceptEdits" -> stringResource(R.string.permission_mode_auto_edit)
    "auto" -> stringResource(R.string.permission_mode_auto)
    "bypassPermissions" -> stringResource(R.string.permission_mode_bypass)
    else -> mode
}

private fun providerAvatarColor(provider: String?): Color = when (provider?.lowercase()) {
    "codex" -> Color(0xFF1A1A2E)
    "cursor" -> Color(0xFF3B82F6)
    "gemini" -> Color(0xFF1A73E8)
    "opencode" -> Color(0xFFF97316)
    else -> ClaudeCoral
}

@Composable
private fun ProviderAvatarHeader(sizeDp: Int = 32, provider: String? = null) {
    val resId = when (provider?.lowercase()) {
        "codex" -> R.drawable.ic_codex
        "cursor" -> R.drawable.ic_cursor
        "gemini" -> R.drawable.ic_gemini
        "opencode" -> R.drawable.ic_opencode
        else -> R.drawable.ic_claude
    }
    val bgColor = when (provider?.lowercase()) {
        "codex" -> Color(0xFF1A1A2E)
        "cursor" -> Color(0xFF000000)
        "gemini" -> Color.White
        "opencode" -> Color(0xFFF97316)
        else -> Color.Transparent // claude icon has its own bg
    }
    Box(
        Modifier.size(sizeDp.dp).clip(RoundedCornerShape(sizeDp * 0.3f)).background(bgColor),
        contentAlignment = Alignment.Center
    ) {
        Image(
            painter = painterResource(resId),
            contentDescription = providerDisplayName(provider),
            modifier = Modifier.size(sizeDp.dp).padding(if (provider?.lowercase() == "codex" || provider?.lowercase() == "cursor") 2.dp else 0.dp),
        )
    }
}

/** Composer: rounded-xl container with optional image previews, textarea, and footer (image btn + mode pill + send). */
@Composable
private fun ComposerBar(vm: ChatViewModel) {
    var input by rememberSaveable { mutableStateOf("") }
    val mode by vm.permissionMode.collectAsStateWithLifecycle()
    // Provider-aware placeholder: "Message Codex…" / "Message Claude…" etc.
    val items by vm.items.collectAsStateWithLifecycle()
    val currentProv = (items.firstOrNull { it is ChatItem.Assistant } as? ChatItem.Assistant)?.provider
    val placeholderText = stringResource(R.string.chat_input_placeholder, providerDisplayName(currentProv))
    val images by vm.images.collectAsStateWithLifecycle()
    val working by vm.working.collectAsStateWithLifecycle()
    val style = ModeColors[mode] ?: ModeColors["default"]!!
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching {
                    val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: return@runCatching null
                    "data:$mime;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
                }.getOrNull()?.let { vm.addImage(it, "image_${System.currentTimeMillis()}.jpg") }
            }
        }
    }
    val canSend = input.isNotBlank() || images.isNotEmpty()
    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val text = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.takeIf { it.isNotBlank() }
            if (text != null) {
                input = if (input.isBlank()) text else "$input $text"
            }
        }
    }
    fun startVoiceInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
            putExtra(RecognizerIntent.EXTRA_PROMPT, "请说话…")
        }
        runCatching { speechLauncher.launch(intent) }
    }
    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startVoiceInput()
    }
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).imePadding(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),  // web bg-card/80
        shadowElevation = 0.dp,
        border = androidx.compose.foundation.BorderStroke(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)),
    ) {
        Column(Modifier.fillMaxWidth()) {
            if (images.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    images.forEachIndexed { i, img ->
                        ImageThumb(img.dataUrl) { vm.removeImage(i) }
                    }
                }
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                if (input.isBlank()) {
                    Text(
                        placeholderText,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                BasicTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    minLines = 1,
                    maxLines = 5,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { vm.send(input); input = "" }),
                )
            }
            HorizontalDivider(thickness = 0.5.dp, color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(32.dp).clip(RoundedCornerShape(8.dp))
                        .clickable {
                            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    ImageIcon(tint = MaterialTheme.colorScheme.onSurfaceVariant, Modifier.size(18.dp))
                }
                Spacer(Modifier.width(4.dp))
                Box(
                    Modifier.size(32.dp).clip(RoundedCornerShape(8.dp))
                        .clickable {
                            micPerm.launch(android.Manifest.permission.RECORD_AUDIO)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    MicIcon(tint = MaterialTheme.colorScheme.onSurfaceVariant, Modifier.size(18.dp))
                }
                Spacer(Modifier.width(4.dp))
                Row(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(style.bg)
                        .border(1.dp, style.text.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                        .clickable { vm.cyclePermissionMode() }
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(style.text))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        permissionModeLabel(mode),
                        color = style.text,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Spacer(Modifier.width(6.dp))
                TokenButton(vm)
                CommandButton(vm) { name -> vm.runCommand(name) }
                Spacer(Modifier.weight(1f))
                val active = working || canSend
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (working || canSend) UserBubbleBlue else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable(enabled = active) {
                            if (working) vm.abort() else { vm.send(input); input = "" }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    if (working) {
                        Box(Modifier.size(12.dp).clip(RoundedCornerShape(2.dp)).background(Color.White))
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.chat_send), tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ImageThumb(dataUrl: String, onRemove: () -> Unit) {
    val bmp = remember(dataUrl) {
        runCatching {
            val b64 = dataUrl.substringAfter("base64,")
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    Box(Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        bmp?.let {
            Image(it, contentDescription = stringResource(R.string.chat_attachment), modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp)))
        }
        Text(
            "×",
            Modifier.align(Alignment.TopEnd).padding(end = 2.dp).clickable { onRemove() }
                .background(Color.Black.copy(alpha = 0.5f), CircleShape).padding(horizontal = 4.dp),
            color = Color.White,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun ChatTabIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val stroke = w * 0.11f
        val bubble = Path().apply {
            moveTo(w * 0.15f, h * 0.18f)
            lineTo(w * 0.85f, h * 0.18f)
            lineTo(w * 0.85f, h * 0.68f)
            lineTo(w * 0.48f, h * 0.68f)
            lineTo(w * 0.32f, h * 0.86f)
            lineTo(w * 0.32f, h * 0.68f)
            lineTo(w * 0.15f, h * 0.68f)
            close()
        }
        drawPath(bubble, tint, style = Stroke(stroke))
    }
}

@Composable
private fun ShellTabIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val stroke = w * 0.12f
        drawLine(tint, Offset(w * 0.18f, h * 0.28f), Offset(w * 0.42f, h * 0.5f), strokeWidth = stroke)
        drawLine(tint, Offset(w * 0.42f, h * 0.5f), Offset(w * 0.18f, h * 0.72f), strokeWidth = stroke)
        drawLine(tint, Offset(w * 0.54f, h * 0.72f), Offset(w * 0.86f, h * 0.72f), strokeWidth = stroke)
    }
}

@Composable
private fun ImageIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = this.size.width; val h = this.size.height
        drawRect(color = tint, topLeft = Offset(0f, 0f), size = Size(w, h), style = Stroke(width = w * 0.09f))
        drawCircle(color = tint, radius = w * 0.1f, center = Offset(w * 0.7f, h * 0.3f))
        val path = Path().apply {
            moveTo(w * 0.18f, h * 0.78f)
            lineTo(w * 0.4f, h * 0.5f)
            lineTo(w * 0.58f, h * 0.7f)
            lineTo(w * 0.82f, h * 0.78f)
            close()
        }
        drawPath(path, tint)
    }
}

@Composable
private fun TokenButton(vm: ChatViewModel) {
    val tb by vm.tokenBudget.collectAsStateWithLifecycle()
    val used = tb?.used ?: 0
    if (used <= 0) return
    var show by remember { mutableStateOf(false) }
    Box(Modifier.clickable { show = true }.padding(horizontal = 6.dp, vertical = 4.dp)) {
        Text(
            fmtTokens(used),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (show) {
        AlertDialog(
            onDismissRequest = { show = false },
            confirmButton = { TextButton({ show = false }) { Text(stringResource(R.string.chat_ok)) } },
            title = { Text(stringResource(R.string.chat_token_usage)) },
            text = {
                Column {
                    Text(stringResource(R.string.chat_token_used, tb?.used ?: 0, tb?.total ?: 0))
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.chat_token_input, tb?.inputTokens ?: 0), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.chat_token_output, tb?.outputTokens ?: 0), style = MaterialTheme.typography.bodySmall)
                }
            },
        )
    }
}

@Composable
private fun CommandButton(vm: ChatViewModel, onExecute: (String) -> Unit) {
    val cmds by vm.commands.collectAsStateWithLifecycle()
    var expanded by remember { mutableStateOf(false) }
    Box {
        Box(
            Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).clickable { expanded = true },
            contentAlignment = Alignment.Center,
        ) {
            CommandIcon(MaterialTheme.colorScheme.onSurfaceVariant, Modifier.size(18.dp))
            if (cmds.isNotEmpty()) {
                Text(
                    "${cmds.size}",
                    Modifier.align(Alignment.TopEnd).background(MaterialTheme.colorScheme.primary, CircleShape)
                        .padding(horizontal = 3.dp),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            cmds.forEach { c ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(c.name ?: "", style = MaterialTheme.typography.bodyMedium)
                            c.description?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }
                    },
                    onClick = {
                        c.name?.takeIf { it.isNotBlank() }?.let { onExecute(it) }
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun CommandIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height; val s = w * 0.09f
        drawRect(tint, Offset(0f, 0f), Size(w, h), style = Stroke(width = s))
        drawLine(tint, Offset(w * 0.2f, h * 0.8f), Offset(w * 0.8f, h * 0.2f), strokeWidth = s)
    }
}

@Composable
private fun MicIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height
        // Capsule body
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.32f, h * 0.1f),
            size = Size(w * 0.36f, h * 0.5f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.18f, w * 0.18f),
        )
        // Stand
        drawLine(tint, Offset(w * 0.5f, h * 0.62f), Offset(w * 0.5f, h * 0.8f), strokeWidth = w * 0.08f)
        // Base
        drawLine(tint, Offset(w * 0.32f, h * 0.88f), Offset(w * 0.68f, h * 0.88f), strokeWidth = w * 0.08f)
        // Arc (cradle)
        val arc = androidx.compose.ui.graphics.Path().apply {
            moveTo(w * 0.28f, h * 0.5f)
            cubicTo(w * 0.28f, h * 0.78f, w * 0.72f, h * 0.78f, w * 0.72f, h * 0.5f)
        }
        drawPath(arc, tint, style = Stroke(w * 0.08f))
    }
}

@Composable
private fun ConversationsDrawer(
    projectName: String,
    sessions: List<SessionInfo>,
    currentSid: String,
    onSelect: (SessionInfo) -> Unit,
    onNewSession: () -> Unit,
    onBackToProjects: () -> Unit,
) {
    ModalDrawerSheet(drawerContainerColor = MaterialTheme.colorScheme.surface) {
        Text(
            projectName,
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        DrawerActionRow(stringResource(R.string.chat_all_projects), onBackToProjects)
        DrawerActionRow(stringResource(R.string.chat_new_chat), onNewSession, primary = true)
        HorizontalDivider(Modifier.padding(vertical = 4.dp))
        if (sessions.isEmpty()) {
            Text(
                stringResource(R.string.projects_no_conversations),
                Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            LazyColumn(Modifier.fillMaxWidth()) {
                items(sessions, key = { it.id }) { s ->
                    DrawerSessionRow(s, selected = s.id == currentSid) { onSelect(s) }
                }
            }
        }
    }
}

@Composable
private fun DrawerActionRow(label: String, onClick: () -> Unit, primary: Boolean = false) {
    Text(
        label,
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (primary) FontWeight.SemiBold else FontWeight.Normal,
        color = if (primary) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun DrawerSessionRow(s: SessionInfo, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
            .padding(horizontal = 20.dp, vertical = 10.dp)
    ) {
        Text(
            s.summary?.takeIf { it.isNotBlank() } ?: stringResource(R.string.projects_untitled_provider_session, providerDisplayName(s.provider)),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun BranchChip(branch: String, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BranchIcon(MaterialTheme.colorScheme.primary, Modifier.size(12.dp))
        Spacer(Modifier.width(4.dp))
        Text(
            branch.take(18),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
    }
}

@Composable
private fun BranchIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height
        drawCircle(tint, w * 0.13f, Offset(w * 0.7f, h * 0.3f))
        drawCircle(tint, w * 0.13f, Offset(w * 0.3f, h * 0.3f))
        drawCircle(tint, w * 0.13f, Offset(w * 0.3f, h * 0.7f))
        drawLine(tint, Offset(w * 0.3f, h * 0.3f), Offset(w * 0.3f, h * 0.7f), strokeWidth = w * 0.1f)
        val p = Path().apply {
            moveTo(w * 0.3f, h * 0.7f)
            cubicTo(w * 0.95f, h * 0.7f, w * 0.95f, h * 0.3f, w * 0.7f, h * 0.3f)
        }
        drawPath(p, tint, style = Stroke(w * 0.1f))
    }
}

@Composable
private fun FolderIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width; val h = size.height
        val path = Path().apply {
            moveTo(w * 0.05f, h * 0.3f)
            lineTo(w * 0.4f, h * 0.3f)
            lineTo(w * 0.55f, h * 0.15f)
            lineTo(w * 0.95f, h * 0.15f)
            lineTo(w * 0.95f, h * 0.85f)
            lineTo(w * 0.05f, h * 0.85f)
            close()
        }
        drawPath(path, tint, style = Stroke(w * 0.09f))
    }
}

@Composable
private fun HeaderTabSwitcher(selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f))
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HeaderIconTab(0, selected, onSelect) { tint, modifier -> ChatTabIcon(tint, modifier) }
        HeaderIconTab(1, selected, onSelect) { tint, modifier -> ShellTabIcon(tint, modifier) }
        HeaderIconTab(2, selected, onSelect) { tint, modifier -> FolderIcon(tint, modifier) }
        HeaderIconTab(3, selected, onSelect) { tint, modifier -> BranchIcon(tint, modifier) }
    }
}

@Composable
private fun HeaderIconTab(
    index: Int,
    selected: Int,
    onSelect: (Int) -> Unit,
    icon: @Composable (Color, Modifier) -> Unit,
) {
    val active = index == selected
    val tint = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        Modifier
            .size(width = 30.dp, height = 26.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (active) MaterialTheme.colorScheme.surface else Color.Transparent)
            .clickable { onSelect(index) },
        contentAlignment = Alignment.Center,
    ) {
        icon(tint, Modifier.size(14.dp))
    }
}

@Composable
private fun ShellPlaceholder(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.chat_shell), style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.chat_shell_unavailable),
                Modifier.padding(horizontal = 32.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun SourceView(branch: String?, vm: ChatViewModel, modifier: Modifier = Modifier) {
    val status by vm.gitStatus.collectAsStateWithLifecycle()
    val staged by vm.staged.collectAsStateWithLifecycle()
    val fileDiff by vm.fileDiff.collectAsStateWithLifecycle()
    val diff by vm.diff.collectAsStateWithLifecycle()
    val committing by vm.committing.collectAsStateWithLifecycle()
    val gitBusy by vm.gitBusy.collectAsStateWithLifecycle()
    val remoteStatus by vm.remoteStatus.collectAsStateWithLifecycle()

    Box(modifier) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.chat_source_control), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.weight(1f))
                remoteStatus?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        Modifier.clip(RoundedCornerShape(8.dp))
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    "⌥ ${branch ?: "—"}",
                    Modifier.clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { vm.openBranchPicker() }
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.height(8.dp))
            // Remote ops toolbar (fetch/pull/push) + history, guarded by _gitBusy.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = { vm.gitRemote("fetch") }, enabled = !gitBusy) { Text(stringResource(R.string.chat_git_fetch)) }
                OutlinedButton(onClick = { vm.gitRemote("pull") }, enabled = !gitBusy) { Text(stringResource(R.string.chat_git_pull)) }
                OutlinedButton(onClick = { vm.gitRemote("push") }, enabled = !gitBusy) { Text(stringResource(R.string.chat_git_push)) }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { vm.openCommits() }) { Text(stringResource(R.string.chat_git_history)) }
            }
            Spacer(Modifier.height(16.dp))
            val st = status
            if (st == null) {
                Text(
                    stringResource(R.string.chat_git_loading),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            } else {
                val stagedList = staged.toList()
                FileGroup(stringResource(R.string.chat_git_modified), st.modified, Color(0xFFEAB308), stagedList, vm, showDiscard = true)
                FileGroup(stringResource(R.string.chat_git_added), st.added, Color(0xFF22C55E), stagedList, vm)
                FileGroup(stringResource(R.string.chat_git_deleted), st.deleted, Color(0xFFEF4444), stagedList, vm)
                FileGroup(stringResource(R.string.chat_git_untracked), st.untracked, Color(0xFF94A3B8), stagedList, vm)
                if (st.modified.isEmpty() && st.added.isEmpty() && st.deleted.isEmpty() && st.untracked.isEmpty()) {
                    Text(stringResource(R.string.chat_git_clean), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = { vm.generateAndCommit(stagedList) },
                    enabled = stagedList.isNotEmpty() && !committing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(if (committing) stringResource(R.string.chat_git_committing) else stringResource(R.string.chat_git_commit_files, stagedList.size))
                }
            }
        }
        // Diff text takes priority; fall back to currentContent from fileWithDiff.
        val diffPair = diff
        val fileDiffPair = fileDiff
        when {
            diffPair != null -> FileDiffDialog(diffPair.first, diffPair.second, isDiff = true, onDismiss = vm::closeFileDiff)
            fileDiffPair != null -> FileDiffDialog(fileDiffPair.first, fileDiffPair.second?.currentContent, isDiff = false, onDismiss = vm::closeFileDiff)
        }
    }
}

@Composable
private fun FileGroup(label: String, files: List<String>, color: Color, staged: List<String>, vm: ChatViewModel, showDiscard: Boolean = false) {
    if (files.isEmpty()) return
    Text(label, style = MaterialTheme.typography.labelMedium, color = color)
    files.forEach { f ->
        val isStaged = f in staged
        Row(
            Modifier.fillMaxWidth().clickable { vm.toggleStaged(f) }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (isStaged) "☑" else "☐", color = color, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.width(8.dp))
            Text(
                f, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontFamily = FontFamily.Monospace,
            )
            Text(stringResource(R.string.chat_git_view), Modifier.clickable { vm.openFileDiff(f) }.padding(4.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
            if (showDiscard) {
                Text(
                    "↶",
                    Modifier.clickable { vm.discard(f) }.padding(horizontal = 6.dp, vertical = 2.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.titleSmall,
                )
            }
        }
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun FileDiffDialog(path: String, content: String?, isDiff: Boolean, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                "${if (isDiff) stringResource(R.string.chat_diff_prefix) else ""}${path.substringAfterLast('\\').substringAfterLast('/')}",
                style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        },
        text = {
            if (content == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.settings_loading), style = MaterialTheme.typography.bodySmall)
                }
            } else {
                Text(
                    content,
                    Modifier.verticalScroll(rememberScrollState()).heightIn(max = 420.dp),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        },
        confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.chat_close)) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun QuickSettingsPanel(onDismiss: () -> Unit, onLogout: () -> Unit, onOpenExtensions: () -> Unit = {}, onOpenSettings: () -> Unit = {}) {
    val sheet = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp).fillMaxWidth()) {
            Text(stringResource(R.string.quick_settings_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(12.dp))
            SettingsSection(stringResource(R.string.quick_settings_section_appearance))
            SettingToggle(stringResource(R.string.quick_settings_dark_mode), App.settings.darkMode) { App.settings.darkMode = it }
            SettingToggle(stringResource(R.string.quick_settings_show_thinking), App.settings.showThinking) { App.settings.showThinking = it }
            SettingsSection(stringResource(R.string.quick_settings_section_tool_display))
            SettingToggle(stringResource(R.string.quick_settings_auto_expand_tools), App.settings.autoExpandTools) { App.settings.autoExpandTools = it }
            SettingToggle(stringResource(R.string.quick_settings_show_raw_params), App.settings.showRawParams) { App.settings.showRawParams = it }
            SettingsSection(stringResource(R.string.quick_settings_section_view))
            SettingToggle(stringResource(R.string.quick_settings_auto_scroll), App.settings.autoScroll) { App.settings.autoScroll = it }
            SettingsSection(stringResource(R.string.quick_settings_section_input))
            SettingToggle(stringResource(R.string.quick_settings_ctrl_enter), App.settings.ctrlEnterToSend) { App.settings.ctrlEnterToSend = it }
            SettingsSection(stringResource(R.string.quick_settings_section_extensions))
            OutlinedButton(
                onClick = { scope.launch { sheet.hide() }; onOpenExtensions() },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.quick_settings_extensions_readonly)) }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { scope.launch { sheet.hide() }; onOpenSettings() },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.quick_settings_full_settings)) }
            SettingsSection(stringResource(R.string.quick_settings_section_account))
            Button(
                onClick = {
                    scope.launch {
                        App.logout()
                        onDismiss()
                        onLogout()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.quick_settings_sign_out)) }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun SettingsSection(label: String) {
    Spacer(Modifier.height(6.dp))
    Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun SettingToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

private fun fmtTokens(n: Int): String = when {
    n >= 1000 -> "%.1fk".format(n / 1000.0)
    else -> n.toString()
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
private fun DeviceSwitcherSheet(
    devices: List<Device>,
    currentDeviceId: String?,
    onSelect: (String) -> Unit,
    onAdd: () -> Unit,
    onRefresh: () -> Unit,
    onEdit: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Text(
                stringResource(R.string.device_switcher_title),
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            devices.forEach { d ->
                val selected = d.id == currentDeviceId
                Row(
                    Modifier.fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else Color.Transparent)
                        .clickable { onSelect(d.id) }
                        .padding(horizontal = 12.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("🖥️", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            d.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                        )
                        Text(
                            if (d.lan.isNullOrBlank()) {
                                stringResource(R.string.device_switcher_relay_token, d.token.takeLast(6))
                            } else {
                                stringResource(R.string.device_switcher_lan, d.lan ?: "")
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    Text(
                        "✎",
                        Modifier.clickable { onEdit(d.id) }.padding(8.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        if (selected) "●" else "○",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onAdd).padding(horizontal = 24.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.device_switcher_add), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onRefresh).padding(horizontal = 24.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.device_switcher_refresh), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun AddDeviceDialog(onConfirm: (String, String, String, String, String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    var lan by rememberSaveable { mutableStateOf("") }
    var ccUser by rememberSaveable { mutableStateOf("") }
    var ccPass by rememberSaveable { mutableStateOf("") }
    val scanPrompt = stringResource(R.string.add_device_scan_prompt)
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { raw ->
            val qr = parseQrPayload(raw)
            if (!qr.token.isNullOrBlank()) {
                token = qr.token
                if (name.isBlank() && !qr.name.isNullOrBlank()) name = qr.name
                qr.lan?.let { if (it.isNotBlank()) lan = it }
                qr.ccUser?.let { if (it.isNotBlank()) ccUser = it }
                qr.ccPass?.let { if (it.isNotBlank()) ccPass = it }
            }
        }
    }
    val camPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanLauncher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats("QR_CODE")
                .setPrompt(scanPrompt)
                .setBeepEnabled(true)
                .setOrientationLocked(true)
        )
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_device_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.add_device_name_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it.trim() },
                    label = { Text(stringResource(R.string.add_device_token_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = lan,
                    onValueChange = { lan = it.trim() },
                    label = { Text(stringResource(R.string.add_device_desktop_url_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.add_device_help),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = ccUser,
                    onValueChange = { ccUser = it },
                    label = { Text(stringResource(R.string.add_device_username_label)) },
                    singleLine = true,
                    enabled = lan.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = ccPass,
                    onValueChange = { ccPass = it },
                    label = { Text(stringResource(R.string.add_device_password_label)) },
                    singleLine = true,
                    enabled = lan.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                TextButton(
                    onClick = { camPerm.launch(android.Manifest.permission.CAMERA) },
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) { Text(stringResource(R.string.add_device_scan_import)) }
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(R.string.add_device_direct_hint),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button({ onConfirm(name, token, lan, ccUser, ccPass) }, enabled = token.isNotBlank() || lan.isNotBlank()) { Text(stringResource(R.string.add_device_confirm)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.add_device_cancel)) } },
    )
}

private fun normalizeHostInput(input: String): String {
    val trimmed = input.trim().trimEnd('/')
    return if (trimmed.isBlank() || trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
}

/** Parsed QR device payload. Supports compact JSON {t,n,lan,u,p} (lan/ccUser/ccPass optional)
 *  for LAN-direct devices, or a raw token string. */
private data class QrDevice(val token: String?, val name: String?, val lan: String?, val ccUser: String?, val ccPass: String?)

private fun parseQrPayload(raw: String): QrDevice {
    val s = raw.trim()
    runCatching {
        val obj = Json { ignoreUnknownKeys = true }.parseToJsonElement(s).jsonObject
        val t = obj["t"]?.jsonPrimitive?.contentOrNull
        if (!t.isNullOrBlank()) return QrDevice(
            token = t,
            name = obj["n"]?.jsonPrimitive?.contentOrNull,
            lan = obj["lan"]?.jsonPrimitive?.contentOrNull,
            ccUser = obj["u"]?.jsonPrimitive?.contentOrNull,
            ccPass = obj["p"]?.jsonPrimitive?.contentOrNull,
        )
    }
    val tok = if (s.contains("token=")) s.substringAfter("token=").substringBefore("&") else s
    return QrDevice(tok.takeIf { it.isNotBlank() }, null, null, null, null)
}

@Composable
private fun EditLanDialog(device: Device, onSave: (String, String, String) -> Unit, onDismiss: () -> Unit) {
    var lan by rememberSaveable { mutableStateOf(device.lan ?: "") }
    var ccUser by rememberSaveable { mutableStateOf(device.ccUser ?: "") }
    var ccPass by rememberSaveable { mutableStateOf(device.ccPass ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.edit_direct_title, device.name)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = lan, onValueChange = { lan = it.trim() },
                    label = { Text(stringResource(R.string.edit_direct_url_label)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = ccUser, onValueChange = { ccUser = it },
                    label = { Text(stringResource(R.string.edit_direct_username)) },
                    singleLine = true, enabled = lan.isNotBlank(), modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = ccPass, onValueChange = { ccPass = it },
                    label = { Text(stringResource(R.string.edit_direct_password)) },
                    singleLine = true, enabled = lan.isNotBlank(), modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(R.string.edit_direct_hint),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button({ onSave(lan, ccUser, ccPass) }) { Text(stringResource(R.string.settings_save)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}
