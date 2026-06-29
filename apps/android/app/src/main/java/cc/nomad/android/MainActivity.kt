package cc.nomad.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import cc.nomad.android.data.TokenHolder
import cc.nomad.android.data.TokenStore
import cc.nomad.android.ui.App
import cc.nomad.android.ui.ChatScreen
import cc.nomad.android.ui.NomadTheme
import cc.nomad.android.ui.ConnectScreen
import java.net.URLDecoder
import java.net.URLEncoder
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    companion object {
        const val CHANNEL_RUN = "nomad_run"
    }

    /** Tracks process-wide foreground state into App.isForeground so ViewModels can decide
     *  whether to post a local notification (only when the app is backgrounded). */
    private val processObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) { App.isForeground = true }
        override fun onStop(owner: LifecycleOwner) { App.isForeground = false }
    }

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* result ignored; best-effort */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        App.init(applicationContext, TokenStore(applicationContext), TokenHolder())
        createRunChannel()
        ensureNotificationPermission()
        ProcessLifecycleOwner.get().lifecycle.addObserver(processObserver)
        setContent { NomadTheme { NomadNav() } }
        // Check for updates in background (silent — only shows dialog if newer version found)
        checkForUpdates()
    }

    private fun checkForUpdates() {
        kotlinx.coroutines.MainScope().launch(kotlinx.coroutines.Dispatchers.IO) {
            val checker = cc.nomad.android.data.UpdateChecker(applicationContext)
            val current = cc.nomad.android.BuildConfig.VERSION_NAME
            val repo = cc.nomad.android.BuildConfig.UPDATE_REPO
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

@Composable
fun NomadNav() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = "connect") {
        composable("connect") {
            ConnectScreen(onLoggedIn = {
                nav.navigate("chat/new") { popUpTo("connect") { inclusive = true } }
            })
        }
        composable("chat/{sid}?cwd={cwd}&title={title}&pid={pid}") { back ->
            val sid = back.arguments?.getString("sid") ?: return@composable
            val cwd = back.arguments?.getString("cwd")
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.takeIf { it.isNotBlank() }
            val title = back.arguments?.getString("title")
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.takeIf { it.isNotBlank() }
            val pid = back.arguments?.getString("pid")
                ?.let { URLDecoder.decode(it, "UTF-8") }
                ?.takeIf { it.isNotBlank() }
            ChatScreen(
                sessionId = sid, cwd = cwd, title = title, projectId = pid,
                onSelectSession = { p, c, session ->
                    val enc = URLEncoder.encode(c ?: "", "UTF-8")
                    val titleEnc = URLEncoder.encode(session.summary ?: "", "UTF-8")
                    val pidEnc = URLEncoder.encode(p, "UTF-8")
                    nav.navigate("chat/${session.id}?cwd=$enc&title=$titleEnc&pid=$pidEnc") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}") { inclusive = true }
                    }
                },
                onNewSession = { p, c ->
                    val enc = URLEncoder.encode(c ?: "", "UTF-8")
                    val pidEnc = URLEncoder.encode(p, "UTF-8")
                    nav.navigate("chat/new?cwd=$enc&pid=$pidEnc") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}") { inclusive = true }
                    }
                },
                onSwitchDevice = {
                    // Switching devices = connecting to a different nomad instance; the old
                    // session/project context is invalid there, so drop it and start fresh.
                    nav.navigate("chat/new") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}") { inclusive = true }
                    }
                },
                onLogout = {
                    nav.navigate("connect") {
                        popUpTo("chat/{sid}?cwd={cwd}&title={title}&pid={pid}") { inclusive = true }
                    }
                },
            )
        }
    }
}
