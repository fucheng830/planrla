package cc.planrla.android.ui

import android.content.ContentValues
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.viewModelScope
import cc.planrla.android.R
import cc.planrla.android.data.CreateFileRequest
import cc.planrla.android.data.FileNode
import cc.planrla.android.data.RenameFileRequest
import cc.planrla.android.data.SaveFileRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

/** Image extensions we know how to render as a bitmap preview in-app. */
private val ImageExts = setOf(
    "png", "jpg", "jpeg", "gif", "webp", "bmp",
)

/** Extensions that have no meaningful in-app preview (kept out of the image set). */
private val BinaryExts = setOf(
    "ico", "tif", "tiff",
    "mp3", "mp4", "wav", "avi", "mov", "webm", "ogg",
    "zip", "gz", "tar", "rar", "7z", "jar", "war",
    "exe", "dll", "so", "dylib", "bin", "class", "pyc", "o", "a",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "woff", "woff2", "ttf", "otf", "eot",
)

private fun extOf(path: String): String =
    path.substringAfterLast('.', "").lowercase()

private fun isImage(path: String): Boolean = extOf(path) in ImageExts

private fun isBinary(path: String): Boolean = extOf(path) in BinaryExts

/** Upper bound for in-memory image decode; bigger files are rejected. */
private const val MaxImageBytes = 5L * 1024 * 1024

data class FileContent(
    val path: String,
    val text: String?,
    val loading: Boolean,
    /** Non-null only when this is a decoded image preview. */
    val bytes: ByteArray? = null,
    /** Marks the in-memory text as truncated because the file exceeded the cap. */
    val truncated: Boolean = false,
) {
    /** True when the viewer should render a bitmap instead of the text body. */
    val isImage: Boolean get() = bytes != null
}

class FilesViewModel(private val projectId: String) : ViewModel() {
    private val _tree = MutableStateFlow<List<FileNode>>(emptyList())
    val tree: StateFlow<List<FileNode>> = _tree
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading
    private val _err = MutableStateFlow<String?>(null)
    val err: StateFlow<String?> = _err
    private val _content = MutableStateFlow<FileContent?>(null)
    val content: StateFlow<FileContent?> = _content
    private val _expanded = MutableStateFlow<Set<String>>(emptySet())
    val expanded: StateFlow<Set<String>> = _expanded

    /** Lightweight toast-style feedback for write operations. */
    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast

    /** True while a multipart upload is in flight (drives the in-tree progress indicator). */
    private val _uploading = MutableStateFlow(false)
    val uploading: StateFlow<Boolean> = _uploading

    init { load() }

    fun load() {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _loading.value = true; _err.value = null
            runCatching { App.api(s).project.files(projectId) }
                .onSuccess { _tree.value = it }
                .onFailure { _err.value = it.message ?: "加载文件失败" }
            _loading.value = false
        }
    }

    fun toggle(path: String) {
        _expanded.value = if (path in _expanded.value) _expanded.value - path else _expanded.value + path
    }

    fun openFile(path: String) {
        if (isImage(path)) {
            openImage(path)
            return
        }
        if (isBinary(path)) {
            _content.value = FileContent(path, "(binary file — preview not available)", false)
            return
        }
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _content.value = FileContent(path, null, true)
            runCatching {
                App.api(s).project.fileContent(projectId, path).use { it.string() }
            }.onSuccess { raw ->
                val capped = if (raw.length > 200_000) raw.take(200_000) + "\n…(truncated)" else raw
                _content.value = FileContent(path, capped, false, truncated = raw.length > 200_000)
            }.onFailure { _content.value = FileContent(path, "Error: ${it.message}", false) }
        }
    }

    /**
     * Fetch the image as raw bytes on an IO thread and stash them in [FileContent.bytes].
     * Files larger than [MaxImageBytes] are rejected with a message so we don't OOM.
     * The bytes are also reused by the Share/Download buttons in the viewer.
     */
    private fun openImage(path: String) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _content.value = FileContent(path, null, true)
            runCatching {
                withContext(Dispatchers.IO) {
                    App.api(s).project.fileContent(projectId, path).use { resp ->
                        val len = resp.contentLength()
                        if (len in 1..MaxImageBytes) {
                            resp.bytes()
                        } else {
                            // Unknown size or too big: stream into a bounded buffer.
                            val buf = resp.byteStream().readBytes()
                            if (buf.size > MaxImageBytes) {
                                throw IllegalStateException("图片过大（${buf.size} 字节 > $MaxImageBytes）")
                            }
                            buf
                        }
                    }
                }
            }.onSuccess { bytes ->
                _content.value = FileContent(path, null, false, bytes = bytes)
            }.onFailure { e ->
                val msg = if (e is IllegalStateException) "Image too large (>${MaxImageBytes / 1024 / 1024}MB)" else "Error: ${e.message ?: "加载失败"}"
                _content.value = FileContent(path, msg, false)
            }
        }
    }

    fun closeFile() { _content.value = null }

    fun consumeToast() { _toast.value = null }

    /** Push an arbitrary message to the toast surface (used by Share/Download). */
    fun pushToast(msg: String) { _toast.value = msg }

    fun saveFile(path: String, content: String) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).project.saveFile(projectId, SaveFileRequest(path, content)) }
                .onSuccess {
                    _toast.value = "Saved: ${path.substringAfterLast('/')}"
                    // refresh viewed content so the viewer reflects saved state
                    _content.value = FileContent(path, content, false)
                }
                .onFailure { _toast.value = "Save failed: ${it.message ?: "error"}" }
        }
    }

    fun createFile(path: String, type: String = "file") {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).project.createFile(projectId, CreateFileRequest(path, type)) }
                .onSuccess {
                    _toast.value = "Created: ${path.substringAfterLast('/')}"
                    load()
                }
                .onFailure { _toast.value = "Create failed: ${it.message ?: "error"}" }
        }
    }

    fun deleteFile(path: String) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).project.deleteFile(projectId, path) }
                .onSuccess {
                    _toast.value = "Deleted: ${path.substringAfterLast('/')}"
                    // if the deleted file was open, close the viewer
                    if (_content.value?.path == path) _content.value = null
                    load()
                }
                .onFailure { _toast.value = "Delete failed: ${it.message ?: "error"}" }
        }
    }

    fun renameFile(oldPath: String, newPath: String) {
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            runCatching { App.api(s).project.renameFile(projectId, RenameFileRequest(oldPath, newPath)) }
                .onSuccess {
                    _toast.value = "Renamed: ${newPath.substringAfterLast('/')}"
                    if (_content.value?.path == oldPath) _content.value = null
                    load()
                }
                .onFailure { _toast.value = "Rename failed: ${it.message ?: "error"}" }
        }
    }

    /**
     * Upload one or more files via the multipart endpoint.
     *
     * Each entry is (fileName, rawBytes); relativePaths is just the file name
     * (flat — we don't reconstruct sub-directories). The Uri → bytes/name
     * resolution happens in the Composable via LocalContext so the VM stays
     * free of Android Context dependencies.
     */
    fun uploadBytes(files: List<Pair<String, ByteArray>>) {
        if (files.isEmpty()) return
        viewModelScope.launch {
            val s = App.resolveBaseUrl() ?: return@launch
            _uploading.value = true
            runCatching {
                val octet = "application/octet-stream".toMediaTypeOrNull()
                val parts = files.mapIndexed { i, (name, bytes) ->
                    val safeName = name.ifBlank { "file$i" }
                    val body = bytes.toRequestBody(octet)
                    MultipartBody.Part.createFormData("files", safeName, body)
                }
                val relPaths = files.mapIndexed { i, (name, _) ->
                    (name.ifBlank { "file$i" }).toRequestBody("text/plain".toMediaTypeOrNull())
                }
                withContext(Dispatchers.IO) {
                    App.api(s).project.uploadFiles(projectId, parts, relPaths)
                }
            }.onSuccess {
                _toast.value = "Uploaded ${files.size} file${if (files.size > 1) "s" else ""}"
                load()
            }.onFailure { _toast.value = "Upload failed: ${it.message ?: "error"}" }
            _uploading.value = false
        }
    }

    companion object {
        fun factory(pid: String) = viewModelFactory { initializer { FilesViewModel(pid) } }
    }
}

@Composable
fun FilesPane(
    projectId: String?,
    modifier: Modifier = Modifier,
    vm: FilesViewModel = viewModel(factory = FilesViewModel.factory(projectId ?: "")),
) {
    val tree by vm.tree.collectAsState()
    val loading by vm.loading.collectAsState()
    val err by vm.err.collectAsState()
    val expanded by vm.expanded.collectAsState()
    val content by vm.content.collectAsState()
    val toast by vm.toast.collectAsState()
    val uploading by vm.uploading.collectAsState()

    var showNewFileDialog by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<String?>(null) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val uploadLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
        // Resolve Uri → (name, bytes) off the main thread, then hand to the VM.
        scope.launch {
            val files = withContext(kotlinx.coroutines.Dispatchers.IO) {
                uris.mapNotNull { uri -> readUriToBytes(context, uri) }
            }
            if (files.isNotEmpty()) vm.uploadBytes(files)
        }
    }

    val rows = remember(tree, expanded) { flatten(tree, expanded) }

    Box(modifier) {
        when {
            projectId.isNullOrBlank() -> Text(
                stringResource(R.string.files_open_project_hint),
                Modifier.align(Alignment.Center).padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            tree.isEmpty() && loading -> CircularProgressIndicator(
                Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.primary
            )
            err != null && tree.isEmpty() -> Text(
                stringResource(R.string.files_error, err.orEmpty()), Modifier.align(Alignment.Center).padding(16.dp),
                color = MaterialTheme.colorScheme.error,
            )
            else -> Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (uploading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    TextButton(
                        onClick = { uploadLauncher.launch("*/*") },
                        enabled = !uploading,
                    ) {
                        Text("⬆")
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.files_upload))
                    }
                    TextButton(onClick = { showNewFileDialog = true }) {
                        Icon(Icons.Filled.Add, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.files_new_file))
                    }
                }
                LazyColumn(Modifier.fillMaxSize()) {
                    items(rows) { (node, depth) ->
                        FileTreeRow(
                            node = node,
                            depth = depth,
                            isExpanded = node.path in expanded,
                            onToggle = vm::toggle,
                            onOpenFile = vm::openFile,
                            onLongPress = { pendingDelete = node.path },
                        )
                    }
                }
            }
        }
    }

    content?.let { fc ->
        // Build the byte payload for the currently-viewed file. For text we
        // encode the (possibly edited) draft; for images we reuse the already
        // fetched bytes. Returns null for error/placeholder states.
        fun currentBytes(): ByteArray? = when {
            fc.isImage -> fc.bytes
            fc.text == null -> null
            fc.text.startsWith("Error:") -> null
            fc.text == "(binary file — preview not available)" -> null
            else -> fc.text.toByteArray(Charsets.UTF_8)
        }

        FileViewer(
            content = fc,
            onClose = vm::closeFile,
            onSave = { newContent -> vm.saveFile(fc.path, newContent) },
            onDelete = { pendingDelete = fc.path },
            onRename = { newPath -> vm.renameFile(fc.path, newPath) },
            onShare = {
                val payload = currentBytes() ?: return@FileViewer
                scope.launch {
                    val msg = withContext(Dispatchers.IO) { shareFile(context, fc.path, payload) }
                    vm.pushToast(msg)
                }
            },
            onDownload = {
                val payload = currentBytes() ?: return@FileViewer
                scope.launch {
                    val msg = withContext(Dispatchers.IO) { downloadFile(context, fc.path, payload) }
                    vm.pushToast(msg)
                }
            },
        )
    }

    if (showNewFileDialog) {
        NewFileEntryDialog(
            onDismiss = { showNewFileDialog = false },
            onCreate = { path, type ->
                showNewFileDialog = false
                vm.createFile(path, type)
            },
        )
    }

    pendingDelete?.let { path ->
        ConfirmDeleteDialog(
            path = path,
            onDismiss = { pendingDelete = null },
            onConfirm = {
                pendingDelete = null
                vm.deleteFile(path)
            },
        )
    }

    toast?.let { msg ->
        Box(Modifier.fillMaxSize()) {
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
                color = MaterialTheme.colorScheme.inverseSurface,
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(localizedFileRuntimeText(msg), modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(12.dp))
                    TextButton(onClick = { vm.consumeToast() }) { Text(stringResource(R.string.chat_ok)) }
                }
            }
        }
    }
}

private fun flatten(tree: List<FileNode>, expanded: Set<String>): List<Pair<FileNode, Int>> {
    val out = mutableListOf<Pair<FileNode, Int>>()
    fun walk(nodes: List<FileNode>, depth: Int) {
        for (n in nodes) {
            out.add(n to depth)
            if (n.isDirectory && n.path in expanded) {
                n.children?.let { walk(it, depth + 1) }
            }
        }
    }
    walk(tree, 0)
    return out
}

/**
 * Read a content:// (or file://) Uri into a (fileName, bytes) pair.
 * Returns null if the stream can't be opened. Caller must run this off the
 * main thread (it performs blocking I/O).
 */
private fun readUriToBytes(
    context: android.content.Context,
    uri: android.net.Uri,
): Pair<String, ByteArray>? {
    val name = queryDisplayName(context, uri)
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    return (name ?: "file") to bytes
}

/** Best-effort display name from the Uri; falls back to the last path segment. */
private fun queryDisplayName(context: android.content.Context, uri: android.net.Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment?.substringAfterLast('/')
    return runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (!c.moveToFirst()) return@use null
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx < 0) null else c.getString(idx)
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/')
}

/** File name for a remote path, tolerating both / and \ separators. */
private fun baseName(path: String): String =
    path.substringAfterLast('\\').substringAfterLast('/')

/** Guess a MIME type for the file; falls back to octet-stream. */
private fun guessMime(path: String): String =
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(extOf(path)) ?: "application/octet-stream"

/**
 * Write [bytes] for [path] into the public Downloads collection and return the
 * content Uri MediaStore handed back. Uses the MediaStore Downloads API on
 * API 29+ (no permission needed); on API 26-28 writes directly to the legacy
 * public Downloads directory (returns the file:// Uri).
 *
 * Must be called off the main thread (does disk + ContentResolver I/O).
 */
private fun writeToDownloads(
    context: android.content.Context,
    path: String,
    bytes: ByteArray,
): Uri {
    val name = baseName(path)
    val mime = guessMime(path)

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values)
            ?: error("无法创建下载文件：$name")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
            ?: error("无法打开下载文件：$uri")
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        uri
    } else {
        @Suppress("DEPRECATION")
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists()) dir.mkdirs()
        val target = java.io.File(dir, name)
        java.io.FileOutputStream(target).use { it.write(bytes) }
        Uri.fromFile(target)
    }
}

/**
 * Fire an ACTION_SEND chooser for [bytes] under [path]. We always route through
 * MediaStore Downloads first (which gives a content:// Uri that needs no
 * FileProvider), then hand that Uri to the share sheet. Returns a user-facing
 * status string.
 *
 * Must be called off the main thread.
 */
private fun shareFile(
    context: android.content.Context,
    path: String,
    bytes: ByteArray,
): String = try {
    val uri = writeToDownloads(context, path, bytes)
    val mime = guessMime(path)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, context.getString(R.string.files_share_chooser_title, baseName(path))))
    "Shared via Downloads: ${baseName(path)}"
} catch (e: Exception) {
    "Share failed: ${e.message ?: "error"}"
}

/**
 * Save [bytes] to Downloads and return a status string for the toast.
 *
 * Must be called off the main thread.
 */
private fun downloadFile(
    context: android.content.Context,
    path: String,
    bytes: ByteArray,
): String = try {
    writeToDownloads(context, path, bytes)
    "Saved to Downloads: ${baseName(path)}"
} catch (e: Exception) {
    "Download failed: ${e.message ?: "error"}"
}

@Composable
private fun FileTreeRow(
    node: FileNode,
    depth: Int,
    isExpanded: Boolean,
    onToggle: (String) -> Unit,
    onOpenFile: (String) -> Unit,
    onLongPress: (String) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .pointerInput(node.path) {
                detectTapGestures(
                    onLongPress = { onLongPress(node.path) },
                    onTap = {
                        if (node.isDirectory) onToggle(node.path) else onOpenFile(node.path)
                    },
                )
            }
            .padding(start = (12 + depth * 16).dp, top = 9.dp, bottom = 9.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (node.isDirectory) {
            Text(
                if (isExpanded) "▾" else "▸",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.width(4.dp))
            Text("📁", style = MaterialTheme.typography.bodyMedium)
        } else {
            Spacer(Modifier.width(14.dp))
            Text("📄", style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            node.name,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FileViewer(
    content: FileContent,
    onClose: () -> Unit,
    onSave: (String) -> Unit,
    onDelete: () -> Unit,
    onRename: (String) -> Unit,
    onShare: () -> Unit,
    onDownload: () -> Unit,
) {
    var editing by remember(content.path) { mutableStateOf(false) }
    var draft by remember(content.path) { mutableStateOf(content.text ?: "") }
    var showRename by remember { mutableStateOf(false) }

    Surface(
        Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.chat_close))
                }
                Text(
                    baseName(content.path),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!content.loading && !content.isImage) {
                    val text = content.text
                    val isError = text != null && text.startsWith("Error:")
                    val isBinaryPlaceholder = text == "(binary file — preview not available)"
                    val canEdit = text != null && !isError && !isBinaryPlaceholder
                    if (editing) {
                        TextButton(onClick = {
                            onSave(draft)
                            editing = false
                        }) { Text(stringResource(R.string.settings_save)) }
                        TextButton(onClick = {
                            draft = content.text ?: ""
                            editing = false
                        }) { Text(stringResource(R.string.settings_cancel)) }
                    } else {
                        if (canEdit) {
                            TextButton(onClick = {
                                draft = content.text ?: ""
                                editing = true
                            }) {
                                Icon(Icons.Filled.Edit, contentDescription = null)
                                Spacer(Modifier.width(4.dp))
                                Text(stringResource(R.string.settings_edit))
                            }
                            TextButton(onClick = { showRename = true }) { Text(stringResource(R.string.files_rename)) }
                        }
                        // Share/Download are always available for viewable text + image files.
                        TextButton(onClick = onShare, enabled = canEdit) { Text(stringResource(R.string.files_share)) }
                        TextButton(onClick = onDownload, enabled = canEdit) { Text(stringResource(R.string.files_download)) }
                        IconButton(onClick = onDelete) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.settings_delete))
                        }
                    }
                } else if (!content.loading && content.isImage) {
                    // Image preview: only Share / Download / Delete in the app bar.
                    TextButton(onClick = onShare) { Text(stringResource(R.string.files_share)) }
                    TextButton(onClick = onDownload) { Text(stringResource(R.string.files_download)) }
                    IconButton(onClick = onDelete) {
                        Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.settings_delete))
                    }
                }
            }
            Box(Modifier.fillMaxSize().padding(12.dp)) {
                when {
                    content.loading -> CircularProgressIndicator(
                        Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.primary
                    )
                    content.isImage -> {
                        val bytes = content.bytes!!
                        // Decode is cheap but synchronous; do it once per bytes change.
                        val bitmap = remember(bytes) {
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        }
                        if (bitmap != null) {
                            val scroll = rememberScrollState()
                            Image(
                                bitmap = bitmap.asImageBitmap(),
                                contentDescription = baseName(content.path),
                                modifier = Modifier.fillMaxWidth().verticalScroll(scroll),
                                contentScale = ContentScale.FillWidth,
                            )
                        } else {
                            Text(
                                stringResource(R.string.files_image_decode_failed),
                                Modifier.align(Alignment.Center),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    editing -> {
                        val scroll = rememberScrollState()
                        val hScroll = rememberScrollState()
                        OutlinedTextField(
                            value = draft,
                            onValueChange = { draft = it },
                            modifier = Modifier.fillMaxSize()
                                .verticalScroll(scroll).horizontalScroll(hScroll),
                            textStyle = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                        )
                    }
                    else -> {
                        val scroll = rememberScrollState()
                        val hScroll = rememberScrollState()
                        Text(
                            localizedFileRuntimeText(content.text ?: ""),
                            Modifier.verticalScroll(scroll).horizontalScroll(hScroll),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }

    if (showRename) {
        RenameDialog(
            currentPath = content.path,
            onDismiss = { showRename = false },
            onConfirm = { newPath ->
                showRename = false
                onRename(newPath)
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewFileEntryDialog(
    onDismiss: () -> Unit,
    onCreate: (path: String, type: String) -> Unit,
) {
    var path by remember { mutableStateOf("") }
    var isDir by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.files_new_file)) },
        text = {
            Column {
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text(stringResource(R.string.files_path_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.size(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.Checkbox(
                        checked = isDir,
                        onCheckedChange = { isDir = it },
                    )
                    Text(stringResource(R.string.files_create_directory))
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = path.isNotBlank(),
                onClick = { onCreate(path.trim(), if (isDir) "directory" else "file") },
            ) { Text(stringResource(R.string.settings_create)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@Composable
private fun localizedFileRuntimeText(message: String): String {
    return when {
        message == "(binary file — preview not available)" ->
            stringResource(R.string.files_binary_preview_unavailable)
        message.startsWith("Error: ") ->
            stringResource(R.string.files_error, message.removePrefix("Error: "))
        message.startsWith("Saved: ") ->
            stringResource(R.string.files_saved, message.removePrefix("Saved: "))
        message.startsWith("Save failed: ") ->
            stringResource(R.string.files_save_failed, message.removePrefix("Save failed: "))
        message.startsWith("Created: ") ->
            stringResource(R.string.files_created, message.removePrefix("Created: "))
        message.startsWith("Create failed: ") ->
            stringResource(R.string.files_create_failed, message.removePrefix("Create failed: "))
        message.startsWith("Deleted: ") ->
            stringResource(R.string.files_deleted, message.removePrefix("Deleted: "))
        message.startsWith("Delete failed: ") ->
            stringResource(R.string.files_delete_failed, message.removePrefix("Delete failed: "))
        message.startsWith("Renamed: ") ->
            stringResource(R.string.files_renamed, message.removePrefix("Renamed: "))
        message.startsWith("Rename failed: ") ->
            stringResource(R.string.files_rename_failed, message.removePrefix("Rename failed: "))
        message.startsWith("Uploaded ") ->
            stringResource(R.string.files_uploaded_count, message.removePrefix("Uploaded ").substringBefore(" "))
        message.startsWith("Upload failed: ") ->
            stringResource(R.string.files_upload_failed, message.removePrefix("Upload failed: "))
        message.startsWith("Image too large") ->
            stringResource(R.string.files_image_too_large)
        message.startsWith("Shared via Downloads: ") ->
            stringResource(R.string.files_shared_via_downloads, message.removePrefix("Shared via Downloads: "))
        message.startsWith("Share failed: ") ->
            stringResource(R.string.files_share_failed, message.removePrefix("Share failed: "))
        message.startsWith("Saved to Downloads: ") ->
            stringResource(R.string.files_saved_to_downloads, message.removePrefix("Saved to Downloads: "))
        message.startsWith("Download failed: ") ->
            stringResource(R.string.files_download_failed, message.removePrefix("Download failed: "))
        else -> message
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConfirmDeleteDialog(
    path: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_delete_title)) },
        text = {
            Text(
                stringResource(R.string.files_delete_message, path.substringAfterLast('/')) + "\n" +
                    if (path.endsWith('/') || !path.substringAfterLast('.', "").contains('.'))
                    stringResource(R.string.files_delete_directory_warning) else "",
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(stringResource(R.string.settings_delete)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RenameDialog(
    currentPath: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var newPath by remember { mutableStateOf(currentPath) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.files_rename_move)) },
        text = {
            OutlinedTextField(
                value = newPath,
                onValueChange = { newPath = it },
                label = { Text(stringResource(R.string.files_new_path)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                enabled = newPath.isNotBlank() && newPath != currentPath,
                onClick = { onConfirm(newPath.trim()) },
            ) { Text(stringResource(R.string.files_rename)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.settings_cancel)) } },
    )
}
