package cc.planrla.android.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Checks GitHub Releases for a newer APK version. If found, downloads it to the app's
 * cache dir and fires ACTION_VIEW to trigger the system installer.
 *
 * The repo is set via BuildConfig.UPDATE_REPO (owner/repo). Releases use semver tags
 * (v0.1.0, v0.2.0, …). The latest release's tag is compared against the installed
 * versionName; if newer, the APK asset is downloaded + installed.
 */
class UpdateChecker(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    data class UpdateInfo(
        val version: String,        // e.g. "0.2.0"
        val downloadUrl: String,    // direct APK download URL
        val releaseNotes: String,
        val apkSize: Long,
    )

    /** Query GitHub API for the latest release. Returns null if no update or error. */
    suspend fun checkForUpdate(currentVersion: String, repo: String): UpdateInfo? {
        return try {
            val req = Request.Builder()
                .url("https://api.github.com/repos/$repo/releases/latest")
                .header("Accept", "application/vnd.github+json")
                .build()
            val resp = client.newCall(req).execute()
            if (!resp.isSuccessful) return null
            val body = resp.body?.string() ?: return null
            val json = JSONObject(body)

            // Parse tag_name (e.g. "v0.2.0" → "0.2.0")
            val tagName = json.optString("tag_name", "").removePrefix("v")
            if (tagName.isEmpty() || !isNewer(tagName, currentVersion)) return null

            // Find the first .apk asset
            val assets = json.optJSONArray("assets") ?: return null
            var apkUrl: String? = null
            var apkSize = 0L
            for (i in 0 until assets.length()) {
                val asset = assets.optJSONObject(i) ?: continue
                val name = asset.optString("name", "")
                if (name.endsWith(".apk")) {
                    apkUrl = asset.optString("browser_download_url", "")
                    apkSize = asset.optLong("size", 0)
                    break
                }
            }
            if (apkUrl.isNullOrEmpty()) return null

            UpdateInfo(
                version = tagName,
                downloadUrl = apkUrl,
                releaseNotes = json.optString("body", ""),
                apkSize = apkSize,
            )
        } catch (_: Exception) {
            null
        }
    }

    /** Download the APK to cache dir and launch the system installer. Must run on IO thread. */
    suspend fun downloadAndInstall(update: UpdateInfo): Boolean {
        return try {
            val req = Request.Builder().url(update.downloadUrl).build()
            val resp = client.newCall(req).execute()
            if (!resp.isSuccessful) return false
            val bytes = resp.body?.bytes() ?: return false

            // Write to cache dir (no storage permission needed)
            val apkFile = java.io.File(context.cacheDir, "planrla-update.apk")
            apkFile.writeBytes(bytes)

            // Launch installer via FileProvider (API 24+) or direct URI (older)
            val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                androidx.core.content.FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    apkFile
                )
            } else {
                Uri.fromFile(apkFile)
            }

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Open the GitHub release page in the browser (fallback if FileProvider not configured). */
    fun openReleasePage(repo: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/$repo/releases/latest"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    /** Compare two semver strings (e.g. "0.2.0" > "0.1.0" = true). */
    private fun isNewer(remote: String, current: String): Boolean {
        val r = remote.split(".").map { it.toIntOrNull() ?: 0 }
        val c = current.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(r.size, c.size)) {
            val rv = r.getOrElse(i) { 0 }
            val cv = c.getOrElse(i) { 0 }
            if (rv > cv) return true
            if (rv < cv) return false
        }
        return false
    }
}
