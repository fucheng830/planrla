package cc.planrla.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Read-only viewer for P2 provider capability surfaces (MCP/Models/Skills/Capabilities/Plugins/TaskMaster).
 *  Each section lazily loads raw JSON text from the relay via [App.api]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExtensionsPanel(onDismiss: () -> Unit) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val vm = remember { ExtensionsViewModel() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 640.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
        ) {
            Text("P2 Extensions", style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Default)
            Text(
                "Read-only capability surfaces from the relay.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.padding(8.dp))

            ExtensionSection("MCP Servers", vm.mcpServers) { vm.load(vm.mcpServers) { s -> App.api(s).providerInfo.mcpServers("claude").use { it.string() } } }
            ExtensionSection("Models", vm.models) { vm.load(vm.models) { s -> App.api(s).providerInfo.models("claude").use { it.string() } } }
            ExtensionSection("Skills", vm.skills) { vm.load(vm.skills) { s -> App.api(s).providerInfo.skills("claude").use { it.string() } } }
            ExtensionSection("Capabilities", vm.capabilities) { vm.load(vm.capabilities) { s -> App.api(s).providerInfo.capabilities().use { it.string() } } }
            ExtensionSection("Plugins", vm.plugins) { vm.load(vm.plugins) { s -> App.api(s).plugins.list().use { it.string() } } }
            ExtensionSection("TaskMaster", vm.taskmaster) { vm.load(vm.taskmaster) { s -> App.api(s).taskmaster.status().use { it.string() } } }
            Spacer(Modifier.padding(8.dp))
        }
    }
}

/** One section: a Load button + monospace JSON output (or loading / error state). */
@Composable
private fun ExtensionSection(
    title: String,
    state: StateFlow<ExtensionState>,
    onLoad: () -> Unit,
) {
    val s by state.collectAsState()
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = onLoad, enabled = !s.loading) {
                if (s.loading) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                } else {
                    Text(if (s.text == null) "Load" else "Reload")
                }
            }
        }
        s.error?.let {
            Text(
                "⚠ $it",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        s.text?.let { text ->
            Spacer(Modifier.padding(2.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(10.dp),
            ) {
                Text(
                    text,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

data class ExtensionState(val loading: Boolean = false, val text: String? = null, val error: String? = null)

/** Holds load state for each capability section. Loads on demand into raw JSON text. */
class ExtensionsViewModel : ViewModel() {

    val mcpServers = MutableStateFlow(ExtensionState())
    val models = MutableStateFlow(ExtensionState())
    val skills = MutableStateFlow(ExtensionState())
    val capabilities = MutableStateFlow(ExtensionState())
    val plugins = MutableStateFlow(ExtensionState())
    val taskmaster = MutableStateFlow(ExtensionState())

    /** Fetch and store text into [target]. [block] runs inside viewModelScope with a resolved base URL. */
    fun load(
        target: MutableStateFlow<ExtensionState>,
        block: suspend (String) -> String,
    ) {
        if (target.value.loading) return
        viewModelScope.launch {
            target.value = target.value.copy(loading = true, error = null)
            val s = App.resolveBaseUrl()
            if (s == null) {
                target.value = ExtensionState(error = "no server configured")
                return@launch
            }
            runCatching { block(s) }
                .onSuccess { target.value = ExtensionState(loading = false, text = it.ifBlank { "{}" }) }
                .onFailure { target.value = ExtensionState(error = it.message ?: "request failed") }
        }
    }
}
