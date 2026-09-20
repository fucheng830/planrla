package cc.planrla.android.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import cc.planrla.android.ui.App

/**
 * Receives inline-reply text and permission decisions from run notifications and
 * forwards them over the live WebSocket owned by the foreground ChatViewModel.
 */
class RunNotificationReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val socket = App.liveSocket
        when (intent.action) {
            ACTION_REPLY -> {
                val text = RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(KEY_REPLY)?.toString()?.trim()
                val sid = intent.getStringExtra(RunNotification.EXTRA_SESSION_ID)
                if (!text.isNullOrBlank() && !sid.isNullOrBlank()) {
                    socket?.sendChat(sid, text, null, null)
                }
            }
            ACTION_PERMIT -> {
                val requestId = intent.getStringExtra(EXTRA_REQUEST_ID)
                if (!requestId.isNullOrBlank()) socket?.sendPermissionResponse(requestId, true)
            }
            ACTION_DENY -> {
                val requestId = intent.getStringExtra(EXTRA_REQUEST_ID)
                if (!requestId.isNullOrBlank()) socket?.sendPermissionResponse(requestId, false)
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "cc.planrla.android.ACTION_REPLY"
        const val ACTION_PERMIT = "cc.planrla.android.ACTION_PERMIT"
        const val ACTION_DENY = "cc.planrla.android.ACTION_DENY"
        const val KEY_REPLY = "key_reply"
        const val EXTRA_REQUEST_ID = "request_id"
    }
}
