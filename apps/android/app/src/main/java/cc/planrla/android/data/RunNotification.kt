package cc.planrla.android.data

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
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

    private fun replyRemoteInput(): RemoteInput =
        RemoteInput.Builder(RunNotificationReceiver.KEY_REPLY)
            .setLabel("回复 Claude…")
            .build()

    private fun replyAction(ctx: Context, sessionId: String): NotificationCompat.Action {
        val replyIntent = Intent(ctx, RunNotificationReceiver::class.java)
            .setAction(RunNotificationReceiver.ACTION_REPLY)
            .putExtra(EXTRA_SESSION_ID, sessionId)
        val pi = PendingIntent.getBroadcast(
            ctx, sessionId.hashCode() + 2, replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        return NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send,
            ctx.getString(R.string.notif_reply_action),
            pi,
        ).addRemoteInput(replyRemoteInput()).build()
    }

    private fun permissionAction(
        ctx: Context,
        requestId: String,
        sessionId: String,
        allow: Boolean,
    ): NotificationCompat.Action {
        val intent = Intent(ctx, RunNotificationReceiver::class.java)
            .setAction(if (allow) RunNotificationReceiver.ACTION_PERMIT else RunNotificationReceiver.ACTION_DENY)
            .putExtra(RunNotificationReceiver.EXTRA_REQUEST_ID, requestId)
            .putExtra(EXTRA_SESSION_ID, sessionId)
        val pi = PendingIntent.getBroadcast(
            ctx,
            (requestId + if (allow) "-y" else "-n").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(
            if (allow) android.R.drawable.ic_input_get else android.R.drawable.ic_menu_close_clear_cancel,
            ctx.getString(if (allow) R.string.notif_allow_action else R.string.notif_deny_action),
            pi,
        ).build()
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
            .addAction(
                android.R.drawable.ic_menu_view,
                ctx.getString(R.string.notif_view_action),
                // contentIntent already deep-links; this action mirrors it so the
                // notification shows the "停止 | 查看任务" two-button layout.
                contentIntent(ctx, sessionId),
            )
            .addAction(replyAction(ctx, sessionId))
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
            .addAction(replyAction(ctx, sessionId))
            .build()

    /** High-priority heads-up: Claude needs a permission decision. */
    fun permission(
        ctx: Context,
        sessionId: String,
        providerName: String?,
        requestId: String,
        toolName: String?,
        commandSummary: String?,
    ): Notification {
        val tool = toolName?.takeIf { it.isNotBlank() } ?: "tool"
        val cmd = commandSummary?.takeIf { it.isNotBlank() } ?: tool
        return base(ctx, RunForegroundService.CHANNEL_PERM, sessionId, providerName, commandSummary)
            .setContentTitle(ctx.getString(R.string.notif_perm_title))
            .setContentText(ctx.getString(R.string.notif_perm_body, tool))
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                ctx.getString(R.string.notif_perm_body, tool) + "\n" + cmd
            ))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .addAction(permissionAction(ctx, requestId, sessionId, allow = true))
            .addAction(permissionAction(ctx, requestId, sessionId, allow = false))
            .addAction(replyAction(ctx, sessionId))
            .build()
    }

    /** High-priority heads-up: Claude asked a question and is waiting for an answer. */
    fun inputPrompt(
        ctx: Context,
        sessionId: String,
        providerName: String?,
        question: String?,
    ): Notification =
        base(ctx, RunForegroundService.CHANNEL_PERM, sessionId, providerName, question)
            .setContentTitle(ctx.getString(R.string.notif_input_title))
            .setContentText(
                question?.takeIf { it.isNotBlank() }
                    ?: ctx.getString(R.string.notif_input_body),
            )
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    question?.takeIf { it.isNotBlank() }
                        ?: ctx.getString(R.string.notif_input_body),
                ),
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .addAction(replyAction(ctx, sessionId))
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
