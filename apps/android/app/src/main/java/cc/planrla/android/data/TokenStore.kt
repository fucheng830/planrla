package cc.planrla.android.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private val Context.dataStore by preferencesDataStore(name = "planrla")

@Serializable
data class Device(
    val id: String,
    val name: String,
    val token: String,
    val lan: String? = null,      // LAN address host:port (e.g. 192.168.0.13:3002) for direct mode
    val ccUser: String? = null,   // planrla username for LAN-direct login
    val ccPass: String? = null,   // planrla password for LAN-direct login
)

class TokenStore(private val context: Context) {
    private object Keys {
        val SERVER = stringPreferencesKey("server_url")
        val TOKEN = stringPreferencesKey("jwt")
        val RELAY = stringPreferencesKey("relay_token")
        val DEVICES = stringPreferencesKey("devices_json")
        val CURRENT = stringPreferencesKey("current_device")
        val ACCOUNT_JWT = stringPreferencesKey("account_jwt")
        val ACCOUNT_EMAIL = stringPreferencesKey("account_email")
        // UI settings (persisted QuickSettingsPanel toggles)
        val SET_DARK_MODE = booleanPreferencesKey("set_dark_mode")
        val SET_SHOW_THINKING = booleanPreferencesKey("set_show_thinking")
        val SET_AUTO_EXPAND = booleanPreferencesKey("set_auto_expand")
        val SET_RAW_PARAMS = booleanPreferencesKey("set_raw_params")
        val SET_AUTO_SCROLL = booleanPreferencesKey("set_auto_scroll")
        val SET_CTRL_ENTER = booleanPreferencesKey("set_ctrl_enter")
    }
    private val json = Json { ignoreUnknownKeys = true }
    private fun readDevices(prefs: androidx.datastore.preferences.core.Preferences): List<Device> =
        prefs[Keys.DEVICES]?.let { runCatching { json.decodeFromString(ListSerializer(Device.serializer()), it) }.getOrNull() } ?: emptyList()

    val serverUrl: Flow<String?> = context.dataStore.data.map { it[Keys.SERVER] }
    val token: Flow<String?> = context.dataStore.data.map { it[Keys.TOKEN] }
    val relayToken: Flow<String?> = context.dataStore.data.map { it[Keys.RELAY] }
    val devices: Flow<List<Device>> = context.dataStore.data.map { readDevices(it) }
    val currentDeviceId: Flow<String?> = context.dataStore.data.map { it[Keys.CURRENT] }
    val accountJwt: Flow<String?> = context.dataStore.data.map { it[Keys.ACCOUNT_JWT] }
    val accountEmail: Flow<String?> = context.dataStore.data.map { it[Keys.ACCOUNT_EMAIL] }

    suspend fun serverUrlSync(): String? = serverUrl.first()
    suspend fun tokenSync(): String? = token.first()
    suspend fun relayTokenSync(): String? = relayToken.first()
    suspend fun devicesSync(): List<Device> = devices.first()
    suspend fun currentDeviceIdSync(): String? = currentDeviceId.first()
    suspend fun accountJwtSync(): String? = accountJwt.first()
    suspend fun accountEmailSync(): String? = accountEmail.first()
    suspend fun currentDevice(): Device? {
        val id = currentDeviceIdSync() ?: return null
        return devicesSync().firstOrNull { it.id == id }
    }

    suspend fun setServer(url: String) = context.dataStore.edit { it[Keys.SERVER] = url }
    suspend fun setToken(t: String) = context.dataStore.edit { it[Keys.TOKEN] = t }
    suspend fun setRelayToken(t: String) = context.dataStore.edit { it[Keys.RELAY] = t }
    suspend fun clearRelayToken() = context.dataStore.edit { it.remove(Keys.RELAY) }
    suspend fun setAccount(jwt: String, email: String) = context.dataStore.edit {
        it[Keys.ACCOUNT_JWT] = jwt; it[Keys.ACCOUNT_EMAIL] = email
    }
    suspend fun clearAccount() = context.dataStore.edit {
        it.remove(Keys.ACCOUNT_JWT); it.remove(Keys.ACCOUNT_EMAIL)
    }
    suspend fun setDevices(list: List<Device>) = context.dataStore.edit { prefs ->
        prefs[Keys.DEVICES] = json.encodeToString(ListSerializer(Device.serializer()), list)
    }
    suspend fun setCurrentDevice(id: String) = context.dataStore.edit { prefs ->
        prefs[Keys.CURRENT] = id
        readDevices(prefs).firstOrNull { it.id == id }?.token?.let { prefs[Keys.RELAY] = it }
    }
    suspend fun upsertDevice(d: Device) = context.dataStore.edit { prefs ->
        val list = readDevices(prefs).filterNot { it.id == d.id } + d
        prefs[Keys.DEVICES] = json.encodeToString(ListSerializer(Device.serializer()), list)
    }
    suspend fun removeDevice(id: String) = context.dataStore.edit { prefs ->
        val remaining = readDevices(prefs).filterNot { it.id == id }
        prefs[Keys.DEVICES] = json.encodeToString(ListSerializer(Device.serializer()), remaining)
        if (prefs[Keys.CURRENT] == id) {
            remaining.firstOrNull()?.let { next ->
                prefs[Keys.CURRENT] = next.id
                prefs[Keys.RELAY] = next.token
            } ?: run {
                prefs.remove(Keys.CURRENT)
                prefs.remove(Keys.RELAY)
            }
        }
    }
    suspend fun clear() = context.dataStore.edit { it.remove(Keys.TOKEN); it.remove(Keys.RELAY) }

    /** Persisted UI settings (QuickSettingsPanel toggles). Defaults match SettingsHolder. */
    suspend fun loadSettings(): Map<String, Boolean> = context.dataStore.data.first().let { p ->
        mapOf(
            "darkMode" to (p[Keys.SET_DARK_MODE] ?: false),  // default light
            "showThinking" to (p[Keys.SET_SHOW_THINKING] ?: true),
            "autoExpandTools" to (p[Keys.SET_AUTO_EXPAND] ?: false),
            "showRawParams" to (p[Keys.SET_RAW_PARAMS] ?: false),
            "autoScroll" to (p[Keys.SET_AUTO_SCROLL] ?: true),
            "ctrlEnterToSend" to (p[Keys.SET_CTRL_ENTER] ?: false),
        )
    }
    suspend fun saveSettings(values: Map<String, Boolean>) = context.dataStore.edit { p ->
        values["darkMode"]?.let { p[Keys.SET_DARK_MODE] = it }
        values["showThinking"]?.let { p[Keys.SET_SHOW_THINKING] = it }
        values["autoExpandTools"]?.let { p[Keys.SET_AUTO_EXPAND] = it }
        values["showRawParams"]?.let { p[Keys.SET_RAW_PARAMS] = it }
        values["autoScroll"]?.let { p[Keys.SET_AUTO_SCROLL] = it }
        values["ctrlEnterToSend"]?.let { p[Keys.SET_CTRL_ENTER] = it }
    }
}
