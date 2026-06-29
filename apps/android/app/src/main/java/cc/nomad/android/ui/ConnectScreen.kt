package cc.nomad.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import cc.nomad.android.data.AccountLoginRequest
import cc.nomad.android.data.Device
import cc.nomad.android.data.LoginRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val SignInBlue = Color(0xFF2563EB) // bg-blue-600 (nomad Sign In button)
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

    suspend fun autoLogin(): Boolean {
        val s = App.tokenStore.serverUrlSync()
        // Account session (preferred): JWT from cc.brainmate.cc account login.
        val jwt = App.tokenStore.accountJwtSync()
        if (jwt != null && s != null) {
            runCatching {
                val devs = App.api(s).account.devices("Bearer $jwt").devices
                if (devs.isNotEmpty()) {
                    val existing = App.tokenStore.devicesSync().associateBy { it.id }
                    App.tokenStore.setDevices(devs.map { d ->
                        val ex = existing[d.id]
                        Device(d.id, d.name.ifBlank { "device" }, d.token, ex?.lan, ex?.ccUser, ex?.ccPass)
                    })
                    val cur = App.tokenStore.currentDevice()?.token ?: devs.first().token
                    App.tokenHolder.relayToken = cur
                }
            }
            _state.value = State.LoggedIn(s); return true
        }
        // Legacy: direct nomad token or relay device token.
        val t = App.tokenStore.tokenSync()
        val r = App.tokenStore.relayTokenSync()
        if (s == null || (t == null && r == null)) return false
        t?.let { App.tokenHolder.token = it }
        r?.let { App.tokenHolder.relayToken = it }
        if (r != null && App.tokenStore.devicesSync().isEmpty() && App.tokenStore.currentDeviceIdSync() == null) {
            val id = r.trim()
            App.tokenStore.upsertDevice(Device(id = id, name = "默认", token = id))
            App.tokenStore.setCurrentDevice(id)
        }
        _state.value = State.LoggedIn(s); return true
    }

    fun accountLogin(email: String, pass: String, signup: Boolean) {
        viewModelScope.launch {
            _state.value = State.Loading; _err.value = null
            val srv = "https://cc.brainmate.cc"
            try {
                val req = AccountLoginRequest(email.trim(), pass)
                val r = if (signup) App.api(srv).account.signup(req) else App.api(srv).account.login(req)
                App.tokenStore.setServer(srv)
                App.tokenStore.setAccount(r.token, email.trim())
                val devs = App.api(srv).account.devices("Bearer ${r.token}").devices
                if (devs.isNotEmpty()) {
                    App.tokenStore.setDevices(devs.map { d ->
                        Device(d.id, d.name.ifBlank { "device" }, d.token)
                    })
                    App.tokenStore.setCurrentDevice(devs.first().id)
                    App.tokenHolder.relayToken = devs.first().token
                } else {
                    _err.value = "账号下还没有设备。先在桌面端开启远程访问,或在切换面板里手动添加。"
                }
                _state.value = State.LoggedIn(srv)
            } catch (e: Exception) {
                _err.value = e.message ?: "登录失败"
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
                    // Relay mode: the home agent authenticates to the local nomad; the App
                    // only carries the relay device token, so no /login call is needed here.
                    App.tokenHolder.relayToken = relay
                    App.tokenStore.setRelayToken(relay)
                    val id = relay.trim()
                    App.tokenStore.upsertDevice(Device(id = id, name = "默认", token = id))
                    App.tokenStore.setCurrentDevice(id)
                    _state.value = State.LoggedIn(norm)
                    return@launch
                }
                val r = App.api(norm).auth.login(LoginRequest(user, pass))
                val tok = r.token ?: throw IllegalStateException("no token in response")
                App.tokenHolder.token = tok
                App.tokenStore.setToken(tok)
                _state.value = State.LoggedIn(norm)
            } catch (e: Exception) {
                _err.value = e.message ?: "login failed"
                _state.value = State.Input
            }
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
    LaunchedEffect(Unit) { withContext(Dispatchers.IO) { vm.autoLogin() } }
    LaunchedEffect(state) { if (state is ConnectViewModel.State.LoggedIn) onLoggedIn() }

    var email by rememberSaveable { mutableStateOf("") }
    var pass by rememberSaveable { mutableStateOf("") }
    var signup by rememberSaveable { mutableStateOf(false) }
    val loading = state is ConnectViewModel.State.Loading

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
                    .padding(horizontal = 28.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BrandLogo()
                Spacer(Modifier.height(20.dp))
                Text(
                    "Welcome Back",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Sign in to your nomad self-hosted account",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))

                LabeledField(
                    label = "Email",
                    value = email,
                    onChange = { email = it },
                    placeholder = "you@example.com",
                    ime = ImeAction.Next,
                    enabled = !loading,
                )
                Spacer(Modifier.height(16.dp))
                LabeledField(
                    label = "Password",
                    value = pass,
                    onChange = { pass = it },
                    placeholder = "Enter your password",
                    password = true,
                    ime = ImeAction.Done,
                    enabled = !loading,
                    onSubmit = { if (canAccountSubmit(email, pass, loading)) vm.accountLogin(email, pass, signup) },
                )
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text(
                        if (signup) "已有账号?" else "没有账号?",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        if (signup) "去登录" else "注册",
                        Modifier.clickable { signup = !signup }.padding(horizontal = 2.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Medium,
                    )
                }

                err?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }

                Spacer(Modifier.height(20.dp))
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
                        if (loading) "…" else if (signup) "注册" else "登录",
                        fontWeight = FontWeight.Medium,
                    )
                }

                Spacer(Modifier.height(20.dp))
                Text(
                    "通过 cc.brainmate.cc 账号登录,连接你的执行端设备",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "nomad commercial desktop companion",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private fun canAccountSubmit(email: String, pass: String, loading: Boolean) =
    !loading && email.isNotBlank() && pass.length >= 8

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

/** nomad brand mark: blue rounded square with white chat glyph + coral Claude spark. */
@Composable
private fun BrandLogo() {
    Box(
        Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).background(SignInBlue),
        contentAlignment = Alignment.Center,
    ) {
        // chat-bubble glyph (mirrors nomad's MessageSquare logo)
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
