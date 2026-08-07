package cc.planrla.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.viewModelScope
import cc.planrla.android.R
import cc.planrla.android.data.Project
import cc.planrla.android.data.RenameProjectRequest
import cc.planrla.android.data.RenameSessionRequest
import cc.planrla.android.data.SessionInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val ClaudeCoral = Color(0xFFD97757)
private val StarYellow = Color(0xFFCA8A04) // yellow-600 (web text-yellow-600)
private val RestoreGreen = Color(0xFF059669) // emerald-600

class ProjectsViewModel : ViewModel() {
    private val _items = MutableStateFlow<List<Project>>(emptyList())
    val items: StateFlow<List<Project>> = _items
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading
    private val _err = MutableStateFlow<String?>(null)
    val err: StateFlow<String?> = _err
    private var serverUrl: String? = null

    fun load() {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            serverUrl = s
            _loading.value = true; _err.value = null
            try {
                _items.value = App.api(s).project.projects()
            } catch (e: Exception) {
                _err.value = localizeProjectLoadError(e.message)
            } finally {
                _loading.value = false
            }
        }
    }

    fun setQuery(q: String) { _query.value = q }

    // ---- cross-project full-text session search (SSE) ----
    private val _search = MutableStateFlow<List<SessionInfo>>(emptyList())
    val search: StateFlow<List<SessionInfo>> = _search
    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching
    /** Monotonic token so a stale SSE stream can't overwrite a newer one's results. */
    private var searchGen = 0L

    /** Trigger server-side SSE search for [q]. Debounced by the caller (Sidebar). Replaces
     *  local results on launch, accumulates as `result` events stream in. */
    fun searchSessions(q: String) {
        val trimmed = q.trim()
        if (trimmed.isEmpty()) {
            _search.value = emptyList()
            _searching.value = false
            return
        }
        val gen = ++searchGen
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: run { _searching.value = false; return@launch }
            _searching.value = true
            _search.value = emptyList()
            try {
                cc.planrla.android.data.searchSessions(
                    serverUrl = s,
                    q = trimmed,
                    onResult = { hit ->
                        if (gen == searchGen) _search.value = _search.value + hit
                    },
                    onDone = { if (gen == searchGen) _searching.value = false },
                )
            } catch (_: Exception) {
                if (gen == searchGen) _searching.value = false
            }
        }
    }

    fun toggleStar(p: Project) {
        val s = serverUrl ?: return
        viewModelScope.launch {
            runCatching { App.api(s).project.toggleStar(p.projectId) }
                .onSuccess { r ->
                    _items.value = _items.value.map {
                        if (it.projectId == p.projectId) it.copy(isStarred = r.isStarred) else it
                    }
                }
        }
    }

    private val _renaming = MutableStateFlow<SessionInfo?>(null)
    val renaming: StateFlow<SessionInfo?> = _renaming

    fun startRename(s: SessionInfo) { _renaming.value = s }
    fun cancelRename() { _renaming.value = null }
    fun confirmRename(newSummary: String) {
        val target = _renaming.value ?: return
        val s = serverUrl ?: return
        _renaming.value = null
        viewModelScope.launch {
            runCatching { App.api(s).session.rename(target.id, RenameSessionRequest(newSummary)) }
                .onSuccess { updateSession(target.id) { it.copy(summary = newSummary) } }
        }
    }

    fun deleteSession(s: SessionInfo) {
        val url = serverUrl ?: return
        viewModelScope.launch {
            runCatching { App.api(url).session.delete(s.id) }
                .onSuccess {
                    _items.value = _items.value.map { p ->
                        p.copy(sessions = p.sessions?.filterNot { it.id == s.id })
                    }
                }
        }
    }

    private val _deleting = MutableStateFlow<SessionInfo?>(null)
    val deleting: StateFlow<SessionInfo?> = _deleting
    fun requestDelete(s: SessionInfo) { _deleting.value = s }
    fun cancelDelete() { _deleting.value = null }
    fun confirmDelete() {
        val target = _deleting.value ?: return
        _deleting.value = null
        deleteSession(target)
    }

    // ---- project-level rename / delete ----
    private val _renamingProject = MutableStateFlow<Project?>(null)
    val renamingProject: StateFlow<Project?> = _renamingProject

    fun startRenameProject(p: Project) { _renamingProject.value = p }
    fun cancelRenameProject() { _renamingProject.value = null }
    fun confirmRenameProject(newName: String) {
        val target = _renamingProject.value ?: return
        val s = serverUrl ?: return
        val trimmed = newName.trim()
        if (trimmed.isEmpty()) { _renamingProject.value = null; return }
        _renamingProject.value = null
        viewModelScope.launch {
            runCatching { App.api(s).project.renameProject(target.projectId, RenameProjectRequest(trimmed)) }
                .onSuccess { load() }
        }
    }

    private val _deletingProject = MutableStateFlow<Project?>(null)
    val deletingProject: StateFlow<Project?> = _deletingProject
    fun requestDeleteProject(p: Project) { _deletingProject.value = p }
    fun cancelDeleteProject() { _deletingProject.value = null }
    fun confirmDeleteProject(force: Boolean) {
        val target = _deletingProject.value ?: return
        val s = serverUrl ?: return
        _deletingProject.value = null
        viewModelScope.launch {
            runCatching { App.api(s).project.deleteProject(target.projectId, force) }
                .onSuccess { load() }
        }
    }

    private val _archived = MutableStateFlow<List<SessionInfo>>(emptyList())
    val archived: StateFlow<List<SessionInfo>> = _archived

    fun loadArchived() {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { _archived.value = App.api(s).session.archived().sessions }
        }
    }

    fun restoreSession(id: String) {
        viewModelScope.launch {
            val s = serverUrl ?: App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).session.restore(id) }
                .onSuccess {
                    _archived.value = _archived.value.filterNot { it.id == id }
                    load()
                }
        }
    }

    private fun updateSession(sid: String, transform: (SessionInfo) -> SessionInfo) {
        _items.value = _items.value.map { p ->
            p.copy(sessions = p.sessions?.map { if (it.id == sid) transform(it) else it })
        }
    }

    companion object {
        val Factory = viewModelFactory { initializer { ProjectsViewModel() } }
    }
}

private fun localizeProjectLoadError(message: String?): String {
    val raw = message.orEmpty()
    return when {
        raw.contains("failed to connect", ignoreCase = true) -> "无法连接到桌面端，请确认桌面端正在运行且网络可访问。"
        raw.contains("timeout", ignoreCase = true) || raw.contains("timed out", ignoreCase = true) -> "连接桌面端超时，请检查网络后重试。"
        raw.contains("401") || raw.contains("unauthorized", ignoreCase = true) -> "认证已失效，请重新登录或重新连接桌面端。"
        raw.isBlank() -> "加载项目失败"
        else -> raw
    }
}

private fun parseEpoch(iso: String?): Long = iso?.let {
    runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull()
} ?: 0L

/** Compact relative time for sidebar rows: <1m, Xm, Xhr, Xd. */
private fun formatCompactAge(epochMs: Long): String {
    if (epochMs <= 0L) return ""
    val diffMin = ((System.currentTimeMillis() - epochMs) / (1000 * 60)).toInt()
    if (diffMin < 1) return "<1m"
    if (diffMin < 60) return "${diffMin}m"
    val diffHr = diffMin / 60
    if (diffHr < 24) return "${diffHr}hr"
    return "${diffHr / 24}d"
}

@Composable
fun Sidebar(
    vm: ProjectsViewModel,
    currentSessionId: String?,
    onSession: (projectId: String, cwd: String?, session: SessionInfo) -> Unit,
    onNewSession: (projectId: String, cwd: String?) -> Unit,
    onClose: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val items by vm.items.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val err by vm.err.collectAsStateWithLifecycle()
    val renaming by vm.renaming.collectAsStateWithLifecycle()
    val deleting by vm.deleting.collectAsStateWithLifecycle()
    val renamingProject by vm.renamingProject.collectAsStateWithLifecycle()
    val deletingProject by vm.deletingProject.collectAsStateWithLifecycle()
    val archived by vm.archived.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val searching by vm.searching.collectAsStateWithLifecycle()
    val unread by App.unread.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.load() }
    var tab by rememberSaveable { mutableStateOf(1) } // 0=Projects 1=Conversations 2=Archive (default: Conversations)
    LaunchedEffect(tab) {
        if (tab == 2) vm.loadArchived()
    }

    // Debounced SSE search trigger: fire ~250ms after the query stops changing, only when it's
    // non-empty and we're on a tab where cross-project search makes sense (Conversations).
    LaunchedEffect(query) {
        if (tab != 1) return@LaunchedEffect
        val q = query.trim()
        if (q.isEmpty()) return@LaunchedEffect
        kotlinx.coroutines.delay(250)
        vm.searchSessions(q)
    }

    renaming?.let { session ->
        RenameSessionDialog(
            initial = session.summary ?: "",
            onConfirm = { vm.confirmRename(it) },
            onDismiss = { vm.cancelRename() },
        )
    }
    deleting?.let { session ->
        DeleteSessionDialog(
            sessionSummary = session.summary,
            onConfirm = { vm.confirmDelete() },
            onDismiss = { vm.cancelDelete() },
        )
    }
    renamingProject?.let { project ->
        RenameProjectDialog(
            initial = project.displayName ?: project.path ?: project.projectId,
            onConfirm = { vm.confirmRenameProject(it) },
            onDismiss = { vm.cancelRenameProject() },
        )
    }
    deletingProject?.let { project ->
        DeleteProjectDialog(
            projectName = project.displayName ?: project.path ?: project.projectId,
            onConfirm = { force -> vm.confirmDeleteProject(force) },
            onDismiss = { vm.cancelDeleteProject() },
        )
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(top = 64.dp, start = 16.dp, end = 16.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // planrla logo — matches web /logo.svg gradient mark
            Image(
                painter = painterResource(id = R.drawable.ic_logo),
                contentDescription = "planrla",
                modifier = Modifier.size(28.dp),
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "planrla",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.weight(1f))
            // Refresh button — ghost icon button like web sidebar header
            IconButton(
                onClick = { vm.load() },
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = stringResource(R.string.projects_refresh),
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // Close button
            IconButton(
                onClick = onClose,
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = stringResource(R.string.projects_close),
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // Segmented tab control — matches web's flex rounded-lg bg-muted/50 p-0.5
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                .padding(2.dp),
        ) {
            SidebarTab(Icons.Default.Folder, stringResource(R.string.projects_tab_projects), tab == 0, Modifier.weight(1f)) { tab = 0 }
            SidebarTab(Icons.AutoMirrored.Filled.Message, stringResource(R.string.projects_tab_conversations), tab == 1, Modifier.weight(1f)) { tab = 1 }
            SidebarTab(Icons.Default.Archive, stringResource(R.string.projects_tab_archive), tab == 2, Modifier.weight(1f)) { tab = 2 }
        }
        Spacer(Modifier.height(6.dp))
        if (tab == 0 || tab == 1) {
            OutlinedTextField(
                value = query,
                onValueChange = vm::setQuery,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                placeholder = {
                    Text(
                        if (tab == 0) stringResource(R.string.projects_search_projects) else stringResource(R.string.projects_search_conversations),
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    )
                },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)) },
                trailingIcon = if (query.isNotEmpty()) {
                    {
                        Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).clickable { vm.setQuery("") }, contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.projects_clear_search), modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                } else null,
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
            )
            HorizontalDivider(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                0 -> {
                    val filtered = remember(items, query) {
                        val q = query.trim().lowercase()
                        val matched = if (q.isEmpty()) items else items.filter {
                            (it.displayName ?: it.path ?: it.projectId).lowercase().contains(q)
                        }
                        matched.sortedByDescending { it.isStarred == true }
                    }
                    when {
                        items.isEmpty() && loading -> CircularProgressIndicator(
                            Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.primary
                        )
                        err != null -> Text(
                            stringResource(R.string.files_error, err.orEmpty()),
                            Modifier.align(Alignment.Center).padding(16.dp),
                            color = MaterialTheme.colorScheme.error,
                        )
                        filtered.isEmpty() && query.isNotBlank() -> EmptyState(
                            icon = Icons.Default.Search,
                            title = stringResource(R.string.projects_no_matching_projects),
                            subtitle = stringResource(R.string.projects_try_different_search),
                        )
                        items.isEmpty() -> EmptyState(
                            icon = Icons.Default.Folder,
                            title = stringResource(R.string.projects_no_projects_title),
                            subtitle = stringResource(R.string.projects_no_projects_subtitle),
                        )
                        else -> LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(filtered) { p ->
                                ProjectCard(
                                    p,
                                    onToggleStar = vm::toggleStar,
                                    onNewSession = { onNewSession(p.projectId, p.fullPath ?: p.path) },
                                    onSession = { pid, cwd, session -> onSession(pid, cwd, session) },
                                    onRename = vm::startRename,
                                    onDelete = vm::requestDelete,
                                    onRenameProject = vm::startRenameProject,
                                    onDeleteProject = vm::requestDeleteProject,
                                )
                            }
                        }
                    }
                }
                1 -> {
                    val flat = remember(items) {
                        items.flatMap { p -> (p.sessions ?: emptyList()).map { p to it } }
                            .sortedByDescending { parseEpoch(it.second.lastActivity) }
                    }
                    // Map sessionId -> (projectId, cwd) so search results can be opened.
                    val sessionIndex = remember(items) {
                        buildMap {
                            items.forEach { p ->
                                p.sessions?.forEach { put(it.id, p.projectId to (p.fullPath ?: p.path)) }
                            }
                        }
                    }
                    val q = query.trim()
                    val showingSearch = q.isNotEmpty()
                    when {
                        showingSearch && searching && search.isEmpty() -> CircularProgressIndicator(
                            Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.primary,
                        )
                        showingSearch && search.isEmpty() -> EmptyState(
                            icon = Icons.Default.Search,
                            title = stringResource(R.string.projects_no_matching_conversations),
                            subtitle = stringResource(R.string.projects_try_different_search),
                        )
                        showingSearch -> LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            items(search, key = { it.id }) { s ->
                                val (pid, cwd) = sessionIndex[s.id] ?: ("" to null)
                                SearchResultRow(s) {
                                    if (pid.isNotEmpty()) onSession(pid, cwd, s)
                                }
                            }
                        }
                        flat.isEmpty() -> EmptyState(
                            icon = Icons.AutoMirrored.Filled.Message,
                            title = stringResource(R.string.projects_no_conversations_title),
                            subtitle = stringResource(R.string.projects_no_conversations_subtitle),
                        )
                        else -> LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            items(flat, key = { it.second.id }) { (p, s) ->
                                ConversationRow(
                                    s, p.displayName ?: p.path ?: p.projectId,
                                    selected = s.id == currentSessionId,
                                    unread = s.id in unread,
                                ) { onSession(p.projectId, p.fullPath ?: p.path, s) }
                            }
                        }
                    }
                }
                else -> {
                    if (archived.isEmpty()) {
                        EmptyState(
                            icon = Icons.Default.Archive,
                            title = stringResource(R.string.projects_no_archived_title),
                            subtitle = stringResource(R.string.projects_no_archived_subtitle),
                        )
                    } else {
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(archived, key = { it.id }) { s ->
                                ArchivedRow(s) { vm.restoreSession(s.id) }
                            }
                        }
                    }
                }
            }
        }
        // Sidebar footer — matches web mobile: rounded-xl bg-muted/40 rows with icon + label
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            Spacer(Modifier.height(8.dp))
            // Report Issue (link)
            FooterRow(Icons.Default.BugReport, stringResource(R.string.projects_report_issue), MaterialTheme.colorScheme.onSurface) {}
            Spacer(Modifier.height(4.dp))
            // Join Community (link)
            FooterRow(Icons.Default.Forum, stringResource(R.string.projects_join_community), MaterialTheme.colorScheme.onSurface) {}
            Spacer(Modifier.height(4.dp))
            // Settings
            FooterRow(Icons.Default.Settings, stringResource(R.string.settings_title), MaterialTheme.colorScheme.onSurface, onClick = onOpenSettings)
            Spacer(Modifier.height(8.dp))
            // Version brand line
            Text(
                "planrla v${cc.planrla.android.BuildConfig.VERSION_NAME}",
                Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun FooterRow(icon: ImageVector, label: String, color: Color, onClick: (() -> Unit)? = null) {
    Surface(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .let { m -> if (onClick != null) m.clickable(onClick = onClick) else m },
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = color)
            Spacer(Modifier.width(12.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = color)
        }
    }
}

@Composable
private fun EmptyState(icon: ImageVector, title: String, subtitle: String) {
    Column(
        Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun SidebarTab(icon: ImageVector, label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (selected) MaterialTheme.colorScheme.surface else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(4.dp))
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ConversationRow(s: SessionInfo, project: String, selected: Boolean, unread: Boolean, onClick: () -> Unit) {
    val age = formatCompactAge(parseEpoch(s.lastActivity))
    val borderColor = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.25f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)
    val bgColor = if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.05f) else MaterialTheme.colorScheme.surface
    Surface(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = bgColor,
        border = BorderStroke(1.dp, borderColor),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(20.dp).clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center,
            ) {
                ProviderAvatar(s.provider, 14)
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        s.summary?.takeIf { it.isNotBlank() }
                            ?: stringResource(R.string.projects_untitled_provider_session, providerDisplay(s.provider)),
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (age.isNotEmpty()) {
                        Spacer(Modifier.width(4.dp))
                        Text(
                            age,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        )
                    }
                    if (unread) {
                        Spacer(Modifier.width(6.dp))
                        Box(
                            Modifier.size(8.dp).clip(CircleShape)
                                .background(MaterialTheme.colorScheme.error)
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        project,
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (s.provider?.lowercase() != "claude") {
                        Spacer(Modifier.width(4.dp))
                        ProviderBadge(s.provider)
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(s: SessionInfo, onClick: () -> Unit) {
    Surface(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(20.dp).clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center,
            ) {
                ProviderAvatar(s.provider, 14)
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    s.summary?.takeIf { it.isNotBlank() }
                        ?: stringResource(R.string.projects_untitled_provider_session, providerDisplay(s.provider)),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    s.id,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ArchivedRow(s: SessionInfo, onRestore: () -> Unit) {
    val age = formatCompactAge(parseEpoch(s.lastActivity))
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(20.dp).clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center,
            ) {
                ProviderAvatar(s.provider, 14)
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    s.summary?.takeIf { it.isNotBlank() }
                        ?: stringResource(R.string.projects_untitled_provider_session, providerDisplay(s.provider)),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    age.takeIf { it.isNotEmpty() } ?: (s.lastActivity ?: "—"),
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            Surface(
                Modifier.size(28.dp).clickable(onClick = onRestore),
                shape = RoundedCornerShape(8.dp),
                color = RestoreGreen.copy(alpha = 0.1f),
                border = BorderStroke(1.dp, RestoreGreen.copy(alpha = 0.25f)),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Restore, contentDescription = stringResource(R.string.projects_restore), modifier = Modifier.size(16.dp), tint = RestoreGreen)
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(
    p: Project,
    onToggleStar: (Project) -> Unit,
    onNewSession: () -> Unit,
    onSession: (String, String?, SessionInfo) -> Unit,
    onRename: (SessionInfo) -> Unit,
    onDelete: (SessionInfo) -> Unit,
    onRenameProject: (Project) -> Unit,
    onDeleteProject: (Project) -> Unit,
) {
    var expanded by rememberSaveable(p.projectId) { mutableStateOf(true) }
    val sessions = p.sessions.orEmpty()
    val starColor = if (p.isStarred == true) StarYellow else MaterialTheme.colorScheme.onSurfaceVariant
    val starBorder = if (p.isStarred == true) StarYellow.copy(alpha = 0.3f) else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.2f)
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth().clickable { expanded = !expanded },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Folder icon — rounded square with primary bg (matches web w-8 h-8 rounded-lg)
                Box(
                    Modifier.size(32.dp).clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Folder, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        p.displayName ?: p.path ?: p.projectId,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        stringResource(R.string.projects_sessions_count, sessions.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(6.dp))
                // Star button — ghost style with subtle border
                ProjectActionButton(
                    icon = if (p.isStarred == true) Icons.Default.Star else Icons.Default.StarBorder,
                    bg = starColor.copy(alpha = 0.1f),
                    border = starBorder,
                    tint = starColor,
                    onClick = { onToggleStar(p) },
                )
                Spacer(Modifier.width(4.dp))
                // Edit button — ghost primary
                ProjectActionButton(
                    icon = Icons.Default.Edit,
                    bg = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                    border = MaterialTheme.colorScheme.primary.copy(alpha = 0.25f),
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = { onRenameProject(p) },
                    contentDescription = stringResource(R.string.files_rename),
                )
                Spacer(Modifier.width(4.dp))
                // Delete button — ghost error
                ProjectActionButton(
                    icon = Icons.Default.Delete,
                    bg = MaterialTheme.colorScheme.error.copy(alpha = 0.1f),
                    border = MaterialTheme.colorScheme.error.copy(alpha = 0.25f),
                    tint = MaterialTheme.colorScheme.error,
                    onClick = { onDeleteProject(p) },
                    contentDescription = stringResource(R.string.settings_delete),
                )
                Spacer(Modifier.width(4.dp))
                // Expand/collapse chevron
                Icon(
                    if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = stringResource(if (expanded) R.string.projects_collapse_project else R.string.projects_expand_project),
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded && sessions.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                sessions.forEachIndexed { index, s ->
                    if (index > 0) Spacer(Modifier.height(4.dp))
                    SessionRow(
                        s,
                        onClick = { onSession(p.projectId, p.fullPath ?: p.path, s) },
                        onRename = { onRename(s) },
                        onDelete = { onDelete(s) },
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.projects_new_session),
                Modifier.clip(RoundedCornerShape(8.dp)).clickable { onNewSession() }
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun ProjectActionButton(
    icon: ImageVector,
    bg: Color,
    border: Color,
    tint: Color,
    onClick: () -> Unit,
    contentDescription: String? = null,
) {
    Surface(
        Modifier.size(32.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        color = bg,
        border = BorderStroke(1.dp, border),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(16.dp), tint = tint)
        }
    }
}

@Composable
private fun SessionRow(
    s: SessionInfo,
    onClick: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val age = formatCompactAge(parseEpoch(s.lastActivity))
    SwipeToReveal(
        modifier = Modifier.fillMaxWidth(),
        revealWidth = 140.dp,
        onClick = onClick,
        actions = {
            ActionButton(stringResource(R.string.files_rename), Icons.Default.Edit, MaterialTheme.colorScheme.primary, onRename)
            ActionButton(stringResource(R.string.settings_delete), Icons.Default.Delete, MaterialTheme.colorScheme.error, onDelete)
        },
    ) {
        Surface(
            Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(20.dp).clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center,
                ) {
                    ProviderAvatar(s.provider, 14)
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            s.summary?.takeIf { it.isNotBlank() }
                                ?: stringResource(R.string.projects_untitled_provider_session, providerDisplay(s.provider)),
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (age.isNotEmpty()) {
                            Spacer(Modifier.width(4.dp))
                            Text(
                                age,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                            )
                        }
                    }
                    Text(
                        stringResource(R.string.projects_message_count, s.messageCount ?: 0),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** Horizontal swipe that reveals trailing action buttons (iOS-style). Closed at 0,
 *  open at -revealWidth. Tapping the content closes when open, otherwise calls onClick. */
@Composable
private fun SwipeToReveal(
    modifier: Modifier = Modifier,
    revealWidth: Dp = 140.dp,
    onClick: () -> Unit = {},
    actions: @Composable RowScope.() -> Unit,
    content: @Composable () -> Unit,
) {
    val wPx = with(LocalDensity.current) { revealWidth.toPx() }
    val scope = rememberCoroutineScope()
    val offset = remember { androidx.compose.animation.core.Animatable(0f) }
    Box(modifier.clipToBounds().clip(RoundedCornerShape(8.dp))) {
        Row(
            Modifier.matchParentSize(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically,
            content = actions,
        )
        Box(
            Modifier
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .clickable {
                    if (offset.value < -1f) scope.launch { offset.animateTo(0f) } else onClick()
                }
                .pointerInput(wPx) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            val target = if (offset.value < -wPx / 2f) -wPx else 0f
                            scope.launch { offset.animateTo(target) }
                        },
                        onHorizontalDrag = { change, dragAmount ->
                            change.consume()
                            scope.launch {
                                offset.snapTo((offset.value + dragAmount).coerceIn(-wPx, 0f))
                            }
                        },
                    )
                }
        ) { content() }
    }
}

@Composable
private fun RowScope.ActionButton(
    label: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit,
) {
    Column(
        Modifier.width(70.dp).fillMaxHeight().background(color).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(20.dp), tint = Color.White)
        Text(label, color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun RenameSessionDialog(
    initial: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.projects_rename_session)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.projects_session_summary)) },
            )
        },
        confirmButton = { TextButton({ onConfirm(text.trim()) }) { Text(stringResource(R.string.settings_save)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@Composable
private fun DeleteSessionDialog(sessionSummary: String?, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.projects_delete_session_title)) },
        text = { Text(stringResource(R.string.projects_delete_session_message, sessionSummary?.takeIf { it.isNotBlank() } ?: stringResource(R.string.projects_untitled))) },
        confirmButton = { TextButton(onConfirm) { Text(stringResource(R.string.settings_delete), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@Composable
private fun RenameProjectDialog(
    initial: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.projects_rename_project)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.projects_project_name)) },
            )
        },
        confirmButton = { TextButton({ onConfirm(text.trim()) }) { Text(stringResource(R.string.settings_save)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@Composable
private fun DeleteProjectDialog(
    projectName: String,
    onConfirm: (force: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var force by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.projects_delete_project_title)) },
        text = {
            Column {
                Text(
                    stringResource(R.string.projects_delete_project_message, projectName),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { force = !force }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = force, onCheckedChange = { force = it })
                    Spacer(Modifier.width(8.dp))
                    Text(
                        stringResource(R.string.projects_delete_forever_warning),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        },
        confirmButton = {
            TextButton({ onConfirm(force) }) {
                Text(
                    if (force) stringResource(R.string.projects_delete_forever) else stringResource(R.string.projects_archive),
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

/** Compact colored chip identifying a session's provider (Claude/Codex/Cursor/Gemini/OpenCode).
 *  `null`/empty/unknown falls back to Claude so legacy rows still render. */
private fun providerDisplay(provider: String?): String =
    provider?.trim()?.lowercase()?.replaceFirstChar { it.uppercase() }?.takeIf { it.isNotEmpty() }
        ?: "Claude"

private fun providerColor(provider: String?): Color = when (provider?.trim()?.lowercase()) {
    "codex" -> Color(0xFF10A37F)   // OpenAI green
    "cursor" -> Color(0xFF6B7280)  // gray (cursor brand is UI-dependent; gray is safe)
    "gemini" -> Color(0xFF1A73E8)  // Google blue
    "opencode" -> Color(0xFF6B7280)
    else -> ClaudeCoral            // claude / null / unknown
}

@Composable
private fun ProviderBadge(provider: String?) {
    val label = providerDisplay(provider)
    val color = providerColor(provider)
    Text(
        label,
        Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 5.dp, vertical = 1.dp),
        color = color,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
    )
}

@Composable
private fun ClaudeAvatarSmall(sizeDp: Int = 24) {
    Box(
        Modifier.size(sizeDp.dp).clip(CircleShape).background(ClaudeCoral),
        contentAlignment = Alignment.Center,
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

/** Provider-specific avatar using real vector drawable icons. */
@Composable
private fun ProviderAvatar(provider: String?, sizeDp: Int = 24) {
    val resId = when (provider?.lowercase()) {
        "codex" -> cc.planrla.android.R.drawable.ic_codex
        "cursor" -> cc.planrla.android.R.drawable.ic_cursor
        "gemini" -> cc.planrla.android.R.drawable.ic_gemini
        "kimi" -> cc.planrla.android.R.drawable.ic_kimi
        "opencode" -> cc.planrla.android.R.drawable.ic_opencode
        "zcode" -> cc.planrla.android.R.drawable.ic_zcode
        else -> cc.planrla.android.R.drawable.ic_claude
    }
    val bgColor = when (provider?.lowercase()) {
        "codex" -> Color(0xFF1A1A2E)
        "cursor" -> Color(0xFF000000)
        "gemini" -> Color.White
        "kimi", "zcode" -> Color(0xFF0F172A)
        "opencode" -> Color(0xFFF97316)
        else -> Color.Transparent
    }
    androidx.compose.foundation.Image(
        painter = androidx.compose.ui.res.painterResource(resId),
        contentDescription = provider,
        modifier = Modifier.size(sizeDp.dp).clip(RoundedCornerShape(sizeDp * 0.3f)).background(bgColor),
    )
}
