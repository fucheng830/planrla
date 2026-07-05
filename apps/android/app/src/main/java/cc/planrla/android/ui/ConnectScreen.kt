package cc.planrla.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.viewModelScope
import cc.planrla.android.data.AccountLoginRequest
import cc.planrla.android.data.Device
import cc.planrla.android.data.HostCandidate
import cc.planrla.android.data.HostScanner
import cc.planrla.android.data.LoginRequest
import cc.planrla.android.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val SignInBlue = Color(0xFF2563EB) // bg-blue-600 (planrla Sign In button)
private val ClaudeCoral = Color(0xFFD97757)

class ConnectViewModel : ViewModel() {
    sealed class State {
        object Input : State()
        object Loading : State()
        data class LoggedIn(val server: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.Input)
    val state: StateFlow<State> = _state
    private val _err = MutableStateFlow<String?>(null)
    val err: StateFlow<String?> = _err
    private val _scanResults = MutableStateFlow<List<HostCandidate>>(emptyList())
    val scanResults: StateFlow<List<HostCandidate>> = _scanResults
    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning

    suspend fun autoLogin(): Boolean {
        val s = App.tokenStore.serverUrlSync()
        // Account session (preferred): JWT from api.planrla.com account login.
        val jwt = App.tokenStore.accountJwtSync()
        if (jwt != null && s != null) {
            val restored = runCatching {
                val devs = App.api(s).account.devices("Bearer $jwt").devices
                if (devs.isNotEmpty()) {
                    val existing = App.tokenStore.devicesSync().associateBy { it.id }
                    App.tokenStore.setDevices(devs.map { d ->
                        val ex = existing[d.id]
                        Device(d.id, d.name.ifBlank { App.appContext.getString(R.string.connect_default_device_name) }, d.token, ex?.lan, ex?.ccUser, ex?.ccPass)
                    })
                    if (App.tokenStore.currentDeviceIdSync() == null) {
                        App.tokenStore.setCurrentDevice(devs.first().id)
                    }
                    val current = App.tokenStore.currentDevice()
                    if (current != null && !current.lan.isNullOrBlank()) {
                        App.applyDeviceSelection(current)
                        true
                    } else {
                        App.tokenStore.clear()
                        App.tokenHolder.token = null
                        App.tokenHolder.relayToken = null
                        _err.value = App.appContext.getString(R.string.connect_error_remote_not_ready)
                        false
                    }
                } else {
                    App.tokenStore.setDevices(emptyList())
                    App.tokenStore.clear()
                    App.tokenHolder.token = null
                    App.tokenHolder.relayToken = null
                    _err.value = App.appContext.getString(R.string.connect_error_no_devices)
                    false
                }
            }.getOrDefault(false)
            if (!restored) return false
            _state.value = State.LoggedIn(s); return true
        }
        // Legacy: direct planrla token or relay device token.
        val t = App.tokenStore.tokenSync()
        val r = App.tokenStore.relayTokenSync()
        if (s == null || (t == null && r == null)) return false
        if (t == null && r != null) {
            App.tokenStore.clear()
            App.tokenHolder.relayToken = null
            _err.value = App.appContext.getString(R.string.connect_error_remote_not_ready)
            return false
        }
        t?.let { App.tokenHolder.token = it }
        r?.let { App.tokenHolder.relayToken = it }
        if (r != null && App.tokenStore.devicesSync().isEmpty() && App.tokenStore.currentDeviceIdSync() == null) {
            val id = r.trim()
            App.tokenStore.upsertDevice(Device(id = id, name = App.appContext.getString(R.string.connect_default_device_name), token = id))
            App.tokenStore.setCurrentDevice(id)
        }
        App.applyCurrentDeviceSelection()
        _state.value = State.LoggedIn(s); return true
    }

    fun accountLogin(email: String, pass: String, signup: Boolean) {
        viewModelScope.launch {
            _state.value = State.Loading; _err.value = null
            val srv = "https://api.planrla.com"
            try {
                val req = AccountLoginRequest(email.trim(), pass)
                val r = if (signup) App.api(srv).account.signup(req) else App.api(srv).account.login(req)
                App.tokenStore.setServer(srv)
                App.tokenStore.setAccount(r.token, email.trim())
                val devs = App.api(srv).account.devices("Bearer ${r.token}").devices
                if (devs.isNotEmpty()) {
                    App.tokenStore.setDevices(devs.map { d ->
                        Device(d.id, d.name.ifBlank { App.appContext.getString(R.string.connect_default_device_name) }, d.token)
                    })
                    App.tokenStore.setCurrentDevice(devs.first().id)
                    App.tokenStore.clear()
                    App.tokenHolder.token = null
                    App.tokenHolder.relayToken = null
                    _err.value = App.appContext.getString(R.string.connect_error_remote_not_ready)
                    _state.value = State.Input
                } else {
                    App.tokenStore.setDevices(emptyList())
                    App.tokenStore.clear()
                    App.tokenHolder.token = null
                    App.tokenHolder.relayToken = null
                    _err.value = App.appContext.getString(R.string.connect_error_no_devices)
                    _state.value = State.Input
                }
            } catch (e: Exception) {
                _err.value = e.message ?: App.appContext.getString(R.string.connect_error_login_failed)
                _state.value = State.Input
            }
        }
    }

    fun login(server: String, user: String, pass: String, relay: String) {
        viewModelScope.launch {
            _state.value = State.Loading; _err.value = null
            val norm = server.trimEnd('/')
            try {
                App.tokenStore.setServer(norm)
                if (relay.isNotBlank()) {
                    App.tokenStore.setRelayToken(relay)
                    val id = relay.trim()
                    App.tokenStore.upsertDevice(Device(id = id, name = App.appContext.getString(R.string.connect_default_device_name), token = id))
                    App.tokenStore.setCurrentDevice(id)
                    App.tokenHolder.token = null
                    App.tokenHolder.relayToken = null
                    _err.value = App.appContext.getString(R.string.connect_error_remote_not_ready)
                    _state.value = State.Input
                    return@launch
                }
                val r = App.api(norm).auth.login(LoginRequest(user, pass))
                val tok = r.token ?: throw IllegalStateException("响应中没有令牌")
                App.tokenHolder.token = tok
                App.tokenHolder.relayToken = null
                App.tokenStore.setToken(tok)
                App.tokenStore.clearRelayToken()
                val id = norm
                App.tokenStore.upsertDevice(
                    Device(
                        id = id,
                        name = norm.removePrefix("http://").removePrefix("https://"),
                        token = "",
                        lan = norm,
                        ccUser = user.trim(),
                        ccPass = pass,
                    )
                )
                App.tokenStore.setCurrentDevice(id)
                App.applyCurrentDeviceSelection()
                _state.value = State.LoggedIn(norm)
            } catch (e: Exception) {
                _err.value = e.message ?: App.appContext.getString(R.string.connect_error_login_failed)
                _state.value = State.Input
            }
        }
    }

    fun scanLanHosts() {
        if (_scanning.value) return
        viewModelScope.launch {
            _scanning.value = true; _err.value = null
            runCatching { HostScanner.scan() }
                .onSuccess { _scanResults.value = it }
                .onFailure { _err.value = it.message ?: App.appContext.getString(R.string.connect_error_scan_failed) }
            _scanning.value = false
        }
    }

    companion object {
        val Factory = viewModelFactory { initializer { ConnectViewModel() } }
    }
}

@Composable
fun ConnectScreen(
    vm: ConnectViewModel = viewModel(factory = ConnectViewModel.Factory),
    onLoggedIn: () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val err by vm.err.collectAsStateWithLifecycle()
    val scanResults by vm.scanResults.collectAsStateWithLifecycle()
    val scanning by vm.scanning.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { withContext(Dispatchers.IO) { vm.autoLogin() } }
    LaunchedEffect(state) { if (state is ConnectViewModel.State.LoggedIn) onLoggedIn() }

    var email by rememberSaveable { mutableStateOf("") }
    var pass by rememberSaveable { mutableStateOf("") }
    var signup by rememberSaveable { mutableStateOf(false) }
    var desktopUrl by rememberSaveable { mutableStateOf("") }
    var desktopUser by rememberSaveable { mutableStateOf("") }
    var desktopPass by rememberSaveable { mutableStateOf("") }
    var connectMode by rememberSaveable { mutableStateOf("remote") }
    val loading = state is ConnectViewModel.State.Loading
    val modeRemote = stringResource(R.string.connect_mode_remote)
    val modeDirect = stringResource(R.string.connect_mode_direct)
    val accountPrompt = if (signup) {
        stringResource(R.string.connect_account_has_account)
    } else {
        stringResource(R.string.connect_account_no_account)
    }
    val accountAction = if (signup) {
        stringResource(R.string.connect_account_go_login)
    } else {
        stringResource(R.string.connect_account_signup)
    }
    val submitText = when {
        loading -> "…"
        signup -> stringResource(R.string.connect_signup_find_devices)
        else -> stringResource(R.string.connect_login_find_devices)
    }
    val scanText = if (scanning) {
        stringResource(R.string.connect_scanning)
    } else {
        stringResource(R.string.connect_scan_lan)
    }

    Surface(
        Modifier.fillMaxSize().imePadding(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.Center) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 24.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BrandLogo()
                Spacer(Modifier.height(18.dp))
                Text(
                    stringResource(R.string.connect_title),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.connect_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(22.dp))

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    ConnectModePill(
                        title = modeRemote,
                        subtitle = stringResource(R.string.connect_mode_remote_subtitle),
                        selected = connectMode == "remote",
                        modifier = Modifier.weight(1f),
                    ) { connectMode = "remote" }
                    ConnectModePill(
                        title = modeDirect,
                        subtitle = stringResource(R.string.connect_mode_direct_subtitle),
                        selected = connectMode == "direct",
                        modifier = Modifier.weight(1f),
                    ) { connectMode = "direct" }
                }
                Spacer(Modifier.height(18.dp))

                if (connectMode == "remote") {
                    ConnectionCard(
                        title = modeRemote,
                        description = stringResource(R.string.connect_remote_description),
                        selected = true,
                    ) {
                        LabeledField(
                            label = stringResource(R.string.connect_email),
                            value = email,
                            onChange = { email = it },
                            placeholder = stringResource(R.string.connect_email_placeholder),
                            ime = ImeAction.Next,
                            enabled = !loading,
                        )
                        Spacer(Modifier.height(14.dp))
                        LabeledField(
                            label = stringResource(R.string.connect_password),
                            value = pass,
                            onChange = { pass = it },
                            placeholder = stringResource(R.string.connect_password_placeholder),
                            password = true,
                            ime = ImeAction.Done,
                            enabled = !loading,
                            onSubmit = { if (canAccountSubmit(email, pass, loading)) vm.accountLogin(email, pass, signup) },
                        )
                        Spacer(Modifier.height(10.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                            Text(
                                accountPrompt,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                accountAction,
                                Modifier.clickable { signup = !signup }.padding(horizontal = 2.dp),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                        Spacer(Modifier.height(18.dp))
                        Button(
                            onClick = { vm.accountLogin(email, pass, signup) },
                            enabled = canAccountSubmit(email, pass, loading),
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SignInBlue,
                                disabledContainerColor = SignInBlue.copy(alpha = 0.4f),
                            ),
                        ) {
                            if (loading) {
                                CircularProgressIndicator(
                                    Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(
                                submitText,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            stringResource(R.string.connect_remote_hint),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                } else {
                    ConnectionCard(
                        title = modeDirect,
                        description = stringResource(R.string.connect_direct_description),
                        selected = true,
                    ) {
                        Button(
                            onClick = { vm.scanLanHosts() },
                            enabled = !loading && !scanning,
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = SignInBlue),
                        ) {
                            if (scanning) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(scanText)
                        }
                        scanResults.forEach { host ->
                            Spacer(Modifier.height(8.dp))
                            Surface(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { desktopUrl = host.url }.padding(10.dp),
                                color = MaterialTheme.colorScheme.background,
                            ) {
                                Column {
                                    Text(host.url, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                                    Text(
                                        host.version?.let { stringResource(R.string.connect_host_version, it) }
                                            ?: stringResource(R.string.connect_host_default_name),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(14.dp))
                        LabeledField(
                            label = stringResource(R.string.connect_desktop_url),
                            value = desktopUrl,
                            onChange = { desktopUrl = it },
                            placeholder = "http://192.168.1.20:3001",
                            ime = ImeAction.Next,
                            enabled = !loading,
                        )
                        Spacer(Modifier.height(10.dp))
                        LabeledField(
                            label = stringResource(R.string.connect_desktop_username),
                            value = desktopUser,
                            onChange = { desktopUser = it },
                            placeholder = stringResource(R.string.connect_desktop_username_placeholder),
                            ime = ImeAction.Next,
                            enabled = !loading,
                        )
                        Spacer(Modifier.height(10.dp))
                        LabeledField(
                            label = stringResource(R.string.connect_desktop_password),
                            value = desktopPass,
                            onChange = { desktopPass = it },
                            placeholder = stringResource(R.string.connect_desktop_password_placeholder),
                            password = true,
                            ime = ImeAction.Done,
                            enabled = !loading,
                            onSubmit = { if (desktopUrl.isNotBlank() && desktopUser.isNotBlank()) vm.login(desktopUrl, desktopUser, desktopPass, "") },
                        )
                        Spacer(Modifier.height(14.dp))
                        Button(
                            onClick = { vm.login(desktopUrl, desktopUser, desktopPass, "") },
                            enabled = !loading && desktopUrl.isNotBlank() && desktopUser.isNotBlank(),
                            modifier = Modifier.fillMaxWidth().height(46.dp),
                            shape = RoundedCornerShape(8.dp),
                        ) { Text(stringResource(R.string.connect_direct_button)) }
                    }
                }

                err?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.connect_cloud_disclaimer),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private fun canAccountSubmit(email: String, pass: String, loading: Boolean) =
    !loading && email.isNotBlank() && pass.length >= 8

@Composable
private fun ConnectModePill(
    title: String,
    subtitle: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        modifier = modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else MaterialTheme.colorScheme.background,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline.copy(alpha = 0.45f),
        ),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ConnectionCard(
    title: String,
    description: String,
    selected: Boolean,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.background,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.6f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.35f),
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            content()
        }
    }
}

@Composable
private fun LabeledField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    password: Boolean = false,
    ime: ImeAction = ImeAction.Next,
    enabled: Boolean = true,
    onSubmit: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant) },
            singleLine = true,
            enabled = enabled,
            visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (password) KeyboardType.Password else KeyboardType.Text,
                imeAction = ime,
            ),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                onDone = { onSubmit?.invoke() }
            ),
            shape = RoundedCornerShape(8.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.background,
                unfocusedContainerColor = MaterialTheme.colorScheme.background,
                focusedIndicatorColor = MaterialTheme.colorScheme.primary,
                unfocusedIndicatorColor = MaterialTheme.colorScheme.outline,
                focusedTextColor = MaterialTheme.colorScheme.onSurface,
                unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
            ),
        )
    }
}

/** planrla brand mark: blue rounded square with white chat glyph + coral Claude spark. */
@Composable
private fun BrandLogo() {
    Box(
        Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(SignInBlue),
        contentAlignment = Alignment.Center,
    ) {
        // chat-bubble glyph (mirrors planrla's MessageSquare logo)
        Canvas(Modifier.size(28.dp)) {
            val w = this.size.width
            val h = this.size.height
            val bubble = Path().apply {
                roundedRect(0f, 0f, w, h * 0.78f, w * 0.22f, w * 0.22f)
                moveTo(w * 0.28f, h * 0.74f)
                lineTo(w * 0.28f, h * 0.95f)
                lineTo(w * 0.48f, h * 0.74f)
                close()
            }
            drawPath(bubble, Color.White)
        }
    }
}

private fun Path.roundedRect(left: Float, top: Float, right: Float, bottom: Float, rx: Float, ry: Float) {
    moveTo(left + rx, top)
    lineTo(right - rx, top)
    cubicTo(right, top, right, top, right, top + ry)
    lineTo(right, bottom - ry)
    cubicTo(right, bottom, right, bottom, right - rx, bottom)
    lineTo(left + rx, bottom)
    cubicTo(left, bottom, left, bottom, left, bottom - ry)
    lineTo(left, top + ry)
    cubicTo(left, top, left, top, left + rx, top)
    close()
}
