# 手机端账号化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans。`- [ ]` 勾选跟踪。

**Goal:** cloudcli-android 从「手填 device token」改成**账号登录**(cc.brainmate.cc `/api/auth/*`)→ 拉取账号下设备 → 一键连接。复用已做的多设备 UI(chip / 切换面板 / QR)。

**Architecture:** 新增 `AccountApi`(retrofit,指向 cc.brainmate.cc):signup/login/me/devices。登录后拿 JWT 存 DataStore,`GET /api/devices` 填充 TokenStore.devices,ChatScreen 既有的 switchDevice 走设备 token 连 `wss://cc.brainmate.cc/ws`。本地无单测,沿用 build→install→真机验证。

**Tech Stack:** Kotlin + Retrofit + kotlinx.serialization + Compose(已有)。

---

### Task 1: Account API 数据层

**Files:**
- Modify: `cloudcli-android/app/src/main/java/com/archie/cloudcli/data/ApiService.kt`
- Modify: `cloudcli-android/app/src/main/java/com/archie/cloudcli/data/Net.kt`(ApiProvider 暴露 accountApi)
- Modify: `cloudcli-android/app/src/main/java/com/archie/cloudcli/data/TokenStore.kt`(存 JWT)

- [ ] **Step 1: ApiService.kt 加 AccountApi + 模型**
```kotlin
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
```
(`@Header` import:`import retrofit2.http.Header`)

- [ ] **Step 2: Net.kt — ApiProvider 暴露 accountApi**
`Retrofit2` 类里加 `val account: AccountApi = retrofit.create(AccountApi::class.java)`,`ApiProvider` 加 `val account: AccountApi = r.account`。

- [ ] **Step 3: TokenStore 存 JWT**
Keys 加 `ACCOUNT_JWT = stringPreferencesKey("account_jwt")`、`ACCOUNT_EMAIL`。加 flow + `accountJwtSync()` / `accountEmailSync()` / `setAccount(jwt,email)` / `clearAccount()`。

- [ ] **Step 4: Commit**
```
git commit -m "feat(android): account API data layer (signup/login/devices + JWT store)"
```

---

### Task 2: 账号登录 UI(ConnectScreen)

**Files:**
- Modify: `cloudcli-android/.../ui/ConnectScreen.kt`

- [ ] **Step 1: ConnectViewModel 加 accountLogin**
```kotlin
fun accountLogin(email: String, pass: String, signup: Boolean) {
    viewModelScope.launch {
        _state.value = State.Loading; _err.value = null
        try {
            val srv = "https://cc.brainmate.cc"
            val r = if (signup) App.api(srv).account.signup(AccountLoginRequest(email, pass))
                    else App.api(srv).account.login(AccountLoginRequest(email, pass))
            App.tokenStore.setServer(srv)
            App.tokenStore.setAccount(r.token, email)
            // 拉设备
            val devs = App.api(srv).account.devices("Bearer ${r.token}").devices
            if (devs.isEmpty()) { _err.value = "账号下还没有设备,先在桌面端开启远程访问"; _state.value = State.Input; return@launch }
            App.tokenStore.setDevices(devs.map { Device(it.id, it.name.ifBlank { "device" }, it.token) })
            App.tokenStore.setCurrentDevice(devs.first().id)
            App.tokenHolder.relayToken = devs.first().token
            _state.value = State.LoggedIn(srv)
        } catch (e: Exception) { _err.value = e.message ?: "登录失败"; _state.value = State.Input }
    }
}
```

- [ ] **Step 2: autoLogin 支持账号 JWT**
`autoLogin()` 里:优先检查 `accountJwtSync()`——有就拉设备、setCurrentDevice、登录态。

- [ ] **Step 3: UI 改成账号表单**
ConnectScreen 主表单改成 **Email + Password + 登录/注册 切换**(替换原 user/pass/relay 三栏)。Server 默认 `https://cc.brainmate.cc`(可隐藏或只读展示)。

- [ ] **Step 4: Commit**
```
git commit -m "feat(android): account-based login screen"
```

---

### Task 3: 设备列表接账号(刷新)+ 连接

**Files:**
- Modify: `cloudcli-android/.../ui/ChatScreen.kt`(switchDevice 已有,加 refreshDevices)

- [ ] **Step 1: ChatViewModel.refreshDevices()**
```kotlin
fun refreshDevices() {
    viewModelScope.launch {
        val s = App.tokenStore.serverUrlSync() ?: return@launch
        val jwt = App.tokenStore.accountJwtSync() ?: return@launch
        runCatching { App.api(s).account.devices("Bearer $jwt").devices }
            .onSuccess { App.tokenStore.setDevices(it.map { d -> Device(d.id, d.name.ifBlank { "device" }, d.token) }) }
    }
}
```
切换面板里加「🔄 刷新设备」行(拉最新设备列表)。

- [ ] **Step 2: 连接路径确认**
`start()` 已从 `currentDevice()?.token` 取 token → `wss://cc.brainmate.cc/ws?token=…`。无需改。

- [ ] **Step 3: Commit**
```
git commit -m "feat(android): refresh devices from account in switcher"
```

---

### Task 4: 构建 + 真机验证

- [ ] **Step 1:** `build.bat` 构建。
- [ ] **Step 2:** install 到 AXMNUT2906001086。
- [ ] **Step 3:** 真机:用 `archie@test.com / password123`(云端已注册)登录 → 看到设备列表(home-migrated)→ 连 home → claude 回复。
- [ ] **Step 4:** 验证 DataStore 里 accountJwt + devices 都在。

## 风险
- **signup 用了测试账号 archie@test.com**:正式上线前清掉 D1 里测试数据,或 Archie 用真实邮箱重注册。
- **设备为空兜底**:新账号没设备时给清晰提示(去桌面端配),别让用户卡住。
- **JWT 过期(7天)**:MVP 不做刷新;过期重新登录即可。后续加 refresh token。
