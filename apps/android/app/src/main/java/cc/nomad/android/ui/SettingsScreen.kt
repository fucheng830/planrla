package cc.nomad.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cc.nomad.android.data.ApiKeyRequest
import cc.nomad.android.data.CredentialRequest
import cc.nomad.android.data.GitConfigRequest
import cc.nomad.android.data.NetworkModule
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Full Settings panel: API Keys / GitHub credentials / Git identity.
 *  Uses the same ModalBottomSheet + per-section StateFlow pattern as ExtensionsPanel. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsPanel(onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val vm = remember { SettingsViewModel() }
    // Auto-load all three sections on first show.
    LaunchedEffect(Unit) {
        vm.loadGitConfig()
        vm.loadApiKeys()
        vm.loadCredentials()
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 640.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            Text("Settings", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "API keys, GitHub credentials, and git identity.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))

            GitIdentitySection(vm)
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            ApiKeysSection(vm)
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            CredentialsSection(vm)

            Spacer(Modifier.height(8.dp))
        }
    }
}

// ---- Section header (matches the SettingsSection label style in ChatScreen) ----

@Composable
private fun SettingsSectionLabel(title: String, action: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            Modifier.weight(1f),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        action()
    }
}

@Composable
private fun LoadingErrorRow(loading: Boolean, error: String?) {
    if (loading) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
            Text("Loading…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    error?.let {
        Text("⚠ $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

// ---- 1. Git identity ----

@Composable
private fun GitIdentitySection(vm: SettingsViewModel) {
    val state by vm.gitConfig.collectAsState()
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    // Pre-fill from server once loaded.
    LaunchedEffect(state.loaded) {
        if (state.loaded) { name = state.name; email = state.email }
    }

    SettingsSectionLabel("Git Identity")
    LoadingErrorRow(state.loading, state.error)
    Spacer(Modifier.height(4.dp))
    OutlinedTextField(
        value = name,
        onValueChange = { name = it },
        label = { Text("user.name") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("user.email") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    state.message?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
    }
    Button(
        onClick = { vm.saveGitConfig(name, email) },
        enabled = !state.saving,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (state.saving) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        else Text("Save")
    }
}

// ---- 2. API Keys ----

@Composable
private fun ApiKeysSection(vm: SettingsViewModel) {
    val state by vm.apiKeys.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<NamedItem?>(null) }

    SettingsSectionLabel("API Keys") {
        OutlinedButton(onClick = { showCreate = true }, enabled = !state.loading) { Text("+ New key") }
    }
    LoadingErrorRow(state.loading, state.error)
    Spacer(Modifier.height(4.dp))
    if (state.list.isEmpty() && !state.loading) {
        Text("No API keys.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    state.list.forEach { item ->
        NamedRow(item.name ?: "(unnamed)", item.isActive == true) {
            deleteTarget = item
        }
    }

    if (showCreate) {
        var newName by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("New API key") },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                Button(
                    onClick = { vm.createApiKey(newName) { showCreate = false } },
                    enabled = newName.isNotBlank(),
                ) { Text("Create") }
            },
            dismissButton = { TextButton({ showCreate = false }) { Text("Cancel") } },
        )
    }
    deleteTarget?.let { tgt ->
        ConfirmDeleteDialog(
            label = "API key \"${tgt.name ?: "(unnamed)"}\"",
            onConfirm = { vm.deleteApiKey(tgt.id) { deleteTarget = null } },
            onDismiss = { deleteTarget = null },
        )
    }
}

// ---- 3. GitHub credentials ----

@Composable
private fun CredentialsSection(vm: SettingsViewModel) {
    val state by vm.credentials.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<NamedItem?>(null) }

    SettingsSectionLabel("GitHub Credentials") {
        OutlinedButton(onClick = { showCreate = true }, enabled = !state.loading) { Text("+ New") }
    }
    LoadingErrorRow(state.loading, state.error)
    Spacer(Modifier.height(4.dp))
    if (state.list.isEmpty() && !state.loading) {
        Text("No GitHub credentials.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    state.list.forEach { item ->
        NamedRow(item.name ?: "(unnamed)", isActive = false) {
            deleteTarget = item
        }
    }

    if (showCreate) {
        var newName by remember { mutableStateOf("") }
        var newToken by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("New GitHub credential") },
            text = {
                Column {
                    OutlinedTextField(
                        value = newName,
                        onValueChange = { newName = it },
                        label = { Text("Name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = newToken,
                        onValueChange = { newToken = it },
                        label = { Text("Token (ghp_…)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { vm.createCredential(newName, newToken) { showCreate = false } },
                    enabled = newName.isNotBlank() && newToken.isNotBlank(),
                ) { Text("Create") }
            },
            dismissButton = { TextButton({ showCreate = false }) { Text("Cancel") } },
        )
    }
    deleteTarget?.let { tgt ->
        ConfirmDeleteDialog(
            label = "credential \"${tgt.name ?: "(unnamed)"}\"",
            onConfirm = { vm.deleteCredential(tgt.id) { deleteTarget = null } },
            onDismiss = { deleteTarget = null },
        )
    }
}

/** A list row: name + active badge + 🗑 delete. */
@Composable
private fun NamedRow(name: String, isActive: Boolean, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            name,
            Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (isActive) {
            Text(
                "active",
                Modifier.clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(8.dp))
        }
        Text(
            "🗑",
            Modifier.clip(CircleShape).clickable(onClick = onDelete).padding(6.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
    }
}

@Composable
private fun ConfirmDeleteDialog(label: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete?") },
        text = { Text("Delete $label? This cannot be undone.") },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text("Delete") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
    )
}

// ---- Models ----

/** One list item (api key or credential) — id + display name + optional active flag. */
data class NamedItem(val id: String, val name: String?, val isActive: Boolean = false)

data class GitConfigState(
    val loading: Boolean = false,
    val saving: Boolean = false,
    val loaded: Boolean = false,
    val name: String = "",
    val email: String = "",
    val message: String? = null,
    val error: String? = null,
)

data class ListState(
    val loading: Boolean = false,
    val list: List<NamedItem> = emptyList(),
    val error: String? = null,
)

/** Holds load/list/error state for the three settings sections. Mirrors ExtensionsViewModel. */
class SettingsViewModel : ViewModel() {

    val gitConfig = MutableStateFlow(GitConfigState())
    val apiKeys = MutableStateFlow(ListState())
    val credentials = MutableStateFlow(ListState())

    // ---- Git identity ----

    fun loadGitConfig() {
        if (gitConfig.value.loading) return
        gitConfig.value = gitConfig.value.copy(loading = true, error = null)
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: run {
                gitConfig.value = GitConfigState(error = "no server configured"); return@launch
            }
            runCatching {
                App.api(s).settings.gitConfig().use { raw ->
                    val o = NetworkModule.json.parseToJsonElement(raw.string()) as? JsonObject
                    val n = (o?.get("name") as? JsonPrimitive)?.contentOrNull ?: ""
                    val e = (o?.get("email") as? JsonPrimitive)?.contentOrNull ?: ""
                    GitConfigState(loaded = true, name = n, email = e)
                }
            }.onSuccess { gitConfig.value = it }
                .onFailure { gitConfig.value = GitConfigState(error = it.message ?: "load failed") }
        }
    }

    fun saveGitConfig(name: String, email: String) {
        if (gitConfig.value.saving) return
        gitConfig.value = gitConfig.value.copy(saving = true, message = null, error = null)
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: run {
                gitConfig.value = gitConfig.value.copy(saving = false, error = "no server configured"); return@launch
            }
            runCatching { App.api(s).settings.setGitConfig(GitConfigRequest(name.trim().ifBlank { null }, email.trim().ifBlank { null })) }
                .onSuccess {
                    gitConfig.value = gitConfig.value.copy(
                        saving = false,
                        loaded = true,
                        name = name,
                        email = email,
                        message = "Saved.",
                    )
                }
                .onFailure { gitConfig.value = gitConfig.value.copy(saving = false, error = it.message ?: "save failed") }
        }
    }

    // ---- API keys ----

    fun loadApiKeys() {
        if (apiKeys.value.loading) return
        apiKeys.value = ListState(loading = true)
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: run {
                apiKeys.value = ListState(error = "no server configured"); return@launch
            }
            runCatching {
                App.api(s).settings.apiKeys().use { raw -> parseNamedList(raw.string()) }
            }.onSuccess { apiKeys.value = ListState(list = it) }
                .onFailure { apiKeys.value = ListState(error = it.message ?: "load failed") }
        }
    }

    fun createApiKey(name: String, onDone: () -> Unit) {
        val n = name.trim()
        if (n.isEmpty()) return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).settings.createApiKey(ApiKeyRequest(n)) }
                .onSuccess { loadApiKeys(); onDone() }
        }
    }

    fun deleteApiKey(id: String, onDone: () -> Unit) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).settings.deleteApiKey(id) }
                .onSuccess { loadApiKeys(); onDone() }
        }
    }

    // ---- Credentials (GitHub) ----

    fun loadCredentials() {
        if (credentials.value.loading) return
        credentials.value = ListState(loading = true)
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: run {
                credentials.value = ListState(error = "no server configured"); return@launch
            }
            runCatching {
                App.api(s).settings.credentials("github").use { raw -> parseNamedList(raw.string()) }
            }.onSuccess { credentials.value = ListState(list = it) }
                .onFailure { credentials.value = ListState(error = it.message ?: "load failed") }
        }
    }

    fun createCredential(name: String, token: String, onDone: () -> Unit) {
        val n = name.trim(); val v = token.trim()
        if (n.isEmpty() || v.isEmpty()) return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).settings.createCredential(CredentialRequest(n, "github", v, "")) }
                .onSuccess { loadCredentials(); onDone() }
        }
    }

    fun deleteCredential(id: String, onDone: () -> Unit) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).settings.deleteCredential(id) }
                .onSuccess { loadCredentials(); onDone() }
        }
    }

    /** Parse a JSON array of `{id, name, isActive?}` objects into [NamedItem]s. Tolerates missing fields. */
    private fun parseNamedList(raw: String): List<NamedItem> {
        val arr = NetworkModule.json.parseToJsonElement(raw)
        if (arr !is JsonArray) return emptyList()
        return arr.mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val id = (o["id"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
            val name = (o["name"] as? JsonPrimitive)?.contentOrNull
            val active = (o["isActive"] as? JsonPrimitive)?.contentOrNull?.equals("true", ignoreCase = true) == true
            NamedItem(id, name, active)
        }
    }
}
