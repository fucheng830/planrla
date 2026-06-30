package cc.planrla.android.ui

import android.content.Context
import cc.planrla.android.data.ApiProvider
import cc.planrla.android.data.ChatSocket
import cc.planrla.android.data.LoginRequest
import cc.planrla.android.data.NetworkModule
import cc.planrla.android.data.TokenHolder
import cc.planrla.android.data.TokenStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * Reactive UI settings backed by TokenStore (DataStore). Each setter updates the Compose
 * state immediately AND persists asynchronously. attach() loads persisted values once at
 * app start without blocking the UI thread.
 */
class SettingsHolder {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var store: TokenStore? = null

    private val _darkMode = mutableStateOf(false)  // default light; user can toggle
    private val _showThinking = mutableStateOf(true)
    private val _autoExpandTools = mutableStateOf(false)
    private val _showRawParams = mutableStateOf(false)
    private val _autoScroll = mutableStateOf(true)
    private val _ctrlEnterToSend = mutableStateOf(false)

    var darkMode: Boolean
        get() = _darkMode.value
        set(v) { _darkMode.value = v; persist() }
    var showThinking: Boolean
        get() = _showThinking.value
        set(v) { _showThinking.value = v; persist() }
    var autoExpandTools: Boolean
        get() = _autoExpandTools.value
        set(v) { _autoExpandTools.value = v; persist() }
    var showRawParams: Boolean
        get() = _showRawParams.value
        set(v) { _showRawParams.value = v; persist() }
    var autoScroll: Boolean
        get() = _autoScroll.value
        set(v) { _autoScroll.value = v; persist() }
    var ctrlEnterToSend: Boolean
        get() = _ctrlEnterToSend.value
        set(v) { _ctrlEnterToSend.value = v; persist() }

    fun attach(tokenStore: TokenStore) {
        store = tokenStore
        scope.launch {
            val settings = runCatching { tokenStore.loadSettings() }.getOrNull() ?: return@launch
            withContext(Dispatchers.Main) {
                _darkMode.value = settings["darkMode"] ?: false
                _showThinking.value = settings["showThinking"] ?: true
                _autoExpandTools.value = settings["autoExpandTools"] ?: false
                _showRawParams.value = settings["showRawParams"] ?: false
                _autoScroll.value = settings["autoScroll"] ?: true
                _ctrlEnterToSend.value = settings["ctrlEnterToSend"] ?: false
            }
        }
    }

    private fun persist() {
        val s = store ?: return
        scope.launch {
            s.saveSettings(
                mapOf(
                    "darkMode" to darkMode,
                    "showThinking" to showThinking,
                    "autoExpandTools" to autoExpandTools,
                    "showRawParams" to showRawParams,
                    "autoScroll" to autoScroll,
                    "ctrlEnterToSend" to ctrlEnterToSend,
                )
            )
        }
    }
}

/** UI model for a chat row. Assistant/ToolCard expose StateFlow for incremental updates
 *  so streaming text deltas only recompose that one bubble (no list rebuild). */
sealed class ChatItem {
    data class User(val text: String, val time: Long = 0L) : ChatItem()
    class Assistant(
        val text: MutableStateFlow<String> = MutableStateFlow(""),
        val done: MutableStateFlow<Boolean> = MutableStateFlow(false),
        val time: Long = 0L,
        val provider: String? = null
    ) : ChatItem()
    data class Thinking(val text: String, val time: Long = 0L) : ChatItem()
    class ToolCard(
        val toolName: String?,
        val input: String,
        val toolId: String?,
        val result: MutableStateFlow<String?> = MutableStateFlow(null),
        val isError: MutableStateFlow<Boolean> = MutableStateFlow(false),
        val time: Long = 0L
    ) : ChatItem()
    data class Sys(val text: String) : ChatItem()
}

/** Process-wide singletons holding deps; initialised in MainActivity.onCreate. */
object App {
    @Volatile lateinit var tokenStore: TokenStore
        private set
    @Volatile lateinit var tokenHolder: TokenHolder
        private set
    /** Application context — set in init(); used to post local notifications from ViewModels. */
    @Volatile lateinit var appContext: Context
        private set
    /** Process-wide foreground flag, driven by ProcessLifecycleOwner in MainActivity. ON_START→true, ON_STOP→false. */
    @Volatile var isForeground: Boolean = true
    val settings: SettingsHolder = SettingsHolder()
    val unread = MutableStateFlow<Set<String>>(emptySet())
    fun markUnread(id: String) { unread.value = unread.value + id }
    fun markRead(id: String) { unread.value = unread.value - id }
    @Volatile private var client: okhttp3.OkHttpClient? = null

    fun init(context: Context, store: TokenStore, holder: TokenHolder) {
        appContext = context
        tokenStore = store; tokenHolder = holder
        settings.attach(store)
    }
    private fun client(): okhttp3.OkHttpClient =
        client ?: NetworkModule.okHttp(tokenHolder).also { client = it }
    fun api(serverUrl: String): ApiProvider = ApiProvider(serverUrl, client())
    fun chatSocket(): ChatSocket = ChatSocket(client())

    /** Sign out of the cloud account: clear stored tokens/devices so the next launch shows ConnectScreen. */
    suspend fun logout() {
        tokenStore.clearAccount()
        tokenStore.clear()
        tokenStore.setDevices(emptyList())
        tokenHolder.token = null
        tokenHolder.relayToken = null
        // Invalidate the LAN/relay URL cache so the next login re-probes.
        resolvedKey = null
        resolvedUrl = null
    }

    // Resolved base URL cached per device id so repeated data calls don't re-probe LAN.
    @Volatile private var resolvedKey: String? = null
    @Volatile private var resolvedUrl: String? = null

    /**
     * Effective base URL for the current device: the LAN-direct planrla URL if the device
     * has LAN creds and the 4s login probe succeeds (also switches tokenHolder to the LAN
     * JWT so AuthInterceptor authenticates LAN calls), otherwise the account server URL
     * (relay). Cached per device id — switching devices invalidates it automatically.
     */
    suspend fun resolveBaseUrl(): String? {
        val dev = tokenStore.currentDevice()
        val key = dev?.id
        if (key == resolvedKey && resolvedUrl != null) return resolvedUrl
        val relay = tokenStore.serverUrlSync() ?: return null
        var url = relay
        if (dev != null && !dev.lan.isNullOrBlank() && !dev.ccUser.isNullOrBlank()) {
            val lanUrl = if (dev.lan!!.startsWith("http")) dev.lan!!.trimEnd('/') else "http://${dev.lan}"
            val lanJwt = runCatching {
                withTimeout(4000) { api(lanUrl).auth.login(LoginRequest(dev.ccUser!!, dev.ccPass ?: "")) }
            }.getOrNull()?.token
            if (lanJwt != null) {
                tokenHolder.token = lanJwt
                tokenHolder.relayToken = null
                url = lanUrl
            }
        }
        resolvedKey = key
        resolvedUrl = url
        return url
    }
}
