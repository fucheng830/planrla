package cc.planrla.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeContent
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import cc.planrla.android.data.TokenHolder
import cc.planrla.android.data.TokenStore
import cc.planrla.android.ui.App
import cc.planrla.android.ui.ChatScreen
import cc.planrla.android.ui.NomadTheme
import cc.planrla.android.ui.ConnectScreen
import java.net.URLDecoder
import java.net.URLEncoder
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    companion object {
        const val CHANNEL_RUN = "planrla_run"
    }

   /** Tracks process-wide foreground state into App.isForeground so ViewModels can decide
    *  whether to post a local notification (only when the app is backgrounded). */
   private val processObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            App.isForeground = true
            // Back in the app: the on-screen chat shows live state, so drop the
            // background progress notification.
            cc.planrla.android.data.RunForegroundService.stop(this@MainActivity)
        }
        override fun onStop(owner: LifecycleOwner) {
            App.isForeground = false
            // Backgrounded mid-run: anchor an ongoing progress notification via a
            // foreground service so the OS keeps our (re)connect loop alive and the
            // user sees live status from the launcher/notification shade.
            App.activeRun?.let { run ->
                cc.planrla.android.data.RunForegroundService.start(
                    this@MainActivity, run.sessionId, run.providerName,
                )
            }
        }
   }

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* result ignored; best-effort */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        App.init(applicationContext, TokenStore(applicationContext), TokenHolder())
        createRunChannel()
        ensureNotificationPermission()
        ProcessLifecycleOwner.get().lifecycle.addObserver(processObserver)
        // Deep link from a run notification: navigate straight to the run's chat screen
        // instead of the connect screen. chat re-attaches via chat.subscribe replay.
        val notifSessionId = intent?.getStringExtra(cc.planrla.android.data.RunNotification.EXTRA_SESSION_ID)
        setContent {
            NomadTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // safeContent = safeDrawing ∪ ime: bottom inset = max(navBar, ime) — keeps
                    // content above the nav bar normally, and flush against the keyboard (no gap) when IME open.
                    // Vertical only: on devices reporting horizontal displayCutout insets (waterfall /
                    // aggressively curved screen edges, or the "waterfall cutout" simulator in developer
                    // options), applying them app-wide pads both sides and squashes every screen's width.
                    Box(Modifier.windowInsetsPadding(WindowInsets.safeContent.only(WindowInsetsSides.Vertical))) {
                        NomadNav(notifSessionId)
                    }
                }
            }
        }
        // Check for updates in background (silent — only shows dialog if newer version found).
        // Skip in debug builds so local迭代 doesn't get interrupted by release installers.
        if (!cc.planrla.android.BuildConfig.DEBUG) checkForUpdates()
    }

    private fun checkForUpdates() {
        kotlinx.coroutines.MainScope().launch(kotlinx.coroutines.Dispatchers.IO) {
            val checker = cc.planrla.android.data.UpdateChecker(applicationContext)
            val current = cc.planrla.android.BuildConfig.VERSION_NAME
            val repo = cc.planrla.android.BuildConfig.UPDATE_REPO
            val update = checker.checkForUpdate(current, repo) ?: return@launch
            // Use Android system AlertDialog (no AppCompat theme needed) instead of androidx.appcompat
            withContext(kotlinx.coroutines.Dispatchers.Main) {
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setTitle("Update available: v${update.version}")
                    .setMessage(update.releaseNotes.take(500).ifBlank { "A new version is available." })
                    .setPositiveButton("Download & Install") { _, _ ->
                        kotlinx.coroutines.MainScope().launch(kotlinx.coroutines.Dispatchers.IO) {
                            val ok = checker.downloadAndInstall(update)
                            if (!ok) checker.openReleasePage(repo)
                        }
                    }
                    .setNegativeButton("Later", null)
                    .show()
            }
        }
    }

    override fun onDestroy() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(processObserver)
        super.onDestroy()
    }

   private fun createRunChannel() {
       // NotificationChannel requires API 26+ (Oreo); minSdk is 26 so no guard needed.
       val mgr = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        mgr.createNotificationChannel(
            NotificationChannel(
                cc.planrla.android.data.RunForegroundService.CHANNEL_ACTIVE,
                "运行中任务",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "任务后台执行时显示实时进度" }
        )
        mgr.createNotificationChannel(
            NotificationChannel(
                cc.planrla.android.data.RunForegroundService.CHANNEL_PERM,
                "权限与输入请求",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "Claude 等待权限批准或输入回复时弹出提醒" }
        )
       val channel = NotificationChannel(
           CHANNEL_RUN,
           "Run completion",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply { description = "Notifies you when Claude finishes a run in the background" }
        mgr.createNotificationChannel(channel)
    }

    private fun ensureNotificationPermission() {
        // POST_NOTIFICATIONS is a runtime permission on API 33+ (Tiramisu).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/** Decode a Navigation argument that may still contain `+` for spaces.
 *  Navigation percent-decodes `%XX` but leaves `+` untouched, so we still need
 *  URLDecoder for the plus signs. Titles containing a literal `%` would crash
 *  URLDecoder; in that case fall back to just replacing `+` with spaces. */
private fun safeUrlDecode(value: String): String =
    try {
        URLDecoder.decode(value, "UTF-8")
    } catch (_: IllegalArgumentException) {
        value.replace('+', ' ')
    }

@Composable
fun NomadNav(notifSessionId: String? = null) {
    val nav = rememberNavController()
    NavHost(
        navController = nav,
        startDestination = if (notifSessionId.isNullOrBlank()) "connect" else "chat/$notifSessionId",
    ) {
        composable("connect") {
            ConnectScreen(onLoggedIn = {
                nav.navigate("chat/new") { popUpTo("connect") { inclusive = true } }
            })
        }
        composable("chat/{sid}?cwd={cwd}&title={title}&pid={pid}&prov={prov}") { back ->
            val sid = back.arguments?.getString("sid") ?: return@composable
            val cwd = back.arguments?.getString("cwd")?.let(::safeUrlDecode)?.takeIf { it.isNotBlank() }
            val title = back.arguments?.getString("title")?.let(::safeUrlDecode)?.takeIf { it.isNotBlank() }
            val pid = back.arguments?.getString("pid")?.let(::safeUrlDecode)?.takeIf { it.isNotBlank() }
            val prov = back.arguments?.getString("prov")?.let(::safeUrlDecode)?.takeIf { it.isNotBlank() }
            ChatScreen(
                sessionId = sid, cwd = cwd, title = title, projectId = pid, initialProvider = prov,
                onSelectSession = { p, c, session ->
                    val enc = URLEncoder.encode(c ?: "", "UTF-8")
                    val titleEnc = URLEncoder.encode(session.summary ?: "", "UTF-8")
                    val pidEnc = URLEncoder.encode(p, "UTF-8")
                    val provEnc = URLEncoder.encode(session.provider ?: "", "UTF-8")
                    nav.navigate("chat/${session.id}?cwd=$enc&title=$titleEnc&pid=$pidEnc&prov=$provEnc") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}&prov={prov}") { inclusive = true }
                    }
                },
                onNewSession = { p, c ->
                    val enc = URLEncoder.encode(c ?: "", "UTF-8")
                    val pidEnc = URLEncoder.encode(p, "UTF-8")
                    nav.navigate("chat/new?cwd=$enc&pid=$pidEnc") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}&prov={prov}") { inclusive = true }
                    }
                },
                onSwitchDevice = {
                    // Switching devices = connecting to a different planrla instance; the old
                    // session/project context is invalid there, so drop it and start fresh.
                    nav.navigate("chat/new") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}&prov={prov}") { inclusive = true }
                    }
                },
                onLogout = {
                    nav.navigate("connect") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}&prov={prov}") { inclusive = true }
                    }
                },
            )
        }
    }
}
