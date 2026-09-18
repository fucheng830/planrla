package cc.planrla.android.data

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import cc.planrla.android.MainActivity
import cc.planrla.android.R

/**
 * Builders for run notifications: the ongoing "run in progress" notification anchored by
 * [RunForegroundService] while the app is backgrounded, and the terminal "run finished"
 * notification posted on the existing run-completion channel. Both deep-link back to the
 * run's chat screen via a MainActivity intent extra (handled in NomadNav's start destination).
 */
object RunNotification {
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_PROVIDER = "provider"

    /** Tap target: open MainActivity, which navigates to the run's chat screen. */
    fun contentIntent(ctx: Context, sessionId: String): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            putExtra(EXTRA_SESSION_ID, sessionId)
        }
        return PendingIntent.getActivity(
            ctx, sessionId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Ongoing progress notification (indeterminate bar + elapsed-time chronometer). */
    /** [startedAtMs] anchors the elapsed-time chronometer; 0 falls back to now. Rebuilding
     *  the notification on step updates must reuse the original start time, or the clock
     *  visibly resets on every tool call. */
    fun progress(
        ctx: Context,
        sessionId: String,
        providerName: String?,
        step: String?,
        startedAtMs: Long = 0L,
    ): Notification =
        base(ctx, RunForegroundService.CHANNEL_ACTIVE, sessionId, providerName)
            .setContentText(
                if (step.isNullOrBlank()) ctx.getString(R.string.notif_progress_body)
                else ctx.getString(R.string.notif_progress_step, step)
            )
            .setProgress(0, 0, true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(true)
            .setWhen(if (startedAtMs > 0) startedAtMs else System.currentTimeMillis())
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                ctx.getString(R.string.notif_stop_action),
                PendingIntent.getService(
                    ctx,
                    sessionId.hashCode() + 1,
                    Intent(ctx, RunForegroundService::class.java)
                        .setAction(RunForegroundService.ACTION_ABORT),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    /** Terminal notification on the completion channel (run finished or failed). */
    fun finished(
        ctx: Context,
        sessionId: String,
        providerName: String?,
        ok: Boolean,
        summary: String? = null,
    ): Notification =
        base(ctx, RunForegroundService.CHANNEL_RUN, sessionId, providerName, summary)
            .setContentText(
                summary?.takeIf { it.isNotBlank() }
                ?: ctx.getString(if (ok) R.string.notif_done_body else R.string.notif_error_body),
            )
            .setAutoCancel(true)
            .build()

    private fun base(
        ctx: Context,
        channel: String,
        sessionId: String,
        providerName: String?,
        summary: String? = null,
    ): NotificationCompat.Builder =
        NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(providerName?.takeIf { it.isNotBlank() } ?: ctx.getString(R.string.notif_progress_title))
            .setContentIntent(contentIntent(ctx, sessionId))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
}
