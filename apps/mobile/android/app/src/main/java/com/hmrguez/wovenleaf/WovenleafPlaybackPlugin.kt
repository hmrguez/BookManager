package com.hmrguez.wovenleaf

import android.content.ComponentName
import android.os.Bundle
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture

@CapacitorPlugin(name = "WovenleafPlayback")
class WovenleafPlaybackPlugin : Plugin() {
    private var controllerFuture: ListenableFuture<MediaController>? = null

    override fun load() {
        current = this
        val token = SessionToken(context, ComponentName(context, WovenleafPlaybackService::class.java))
        controllerFuture = MediaController.Builder(context, token).buildAsync()
    }

    override fun handleOnDestroy() {
        if (current === this) current = null
        controllerFuture?.let(MediaController::releaseFuture)
        controllerFuture = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        call.resolve(PlaybackContract.capabilities())
    }

    @PluginMethod fun loadQueue(call: PluginCall) = invoke(call, PlaybackContract.LOAD_QUEUE)
    @PluginMethod fun play(call: PluginCall) = invoke(call, PlaybackContract.PLAY)
    @PluginMethod fun pause(call: PluginCall) = invoke(call, PlaybackContract.PAUSE)
    @PluginMethod fun stop(call: PluginCall) = invoke(call, PlaybackContract.STOP)
    @PluginMethod fun seekToAbsolute(call: PluginCall) = invoke(call, PlaybackContract.SEEK_ABSOLUTE)
    @PluginMethod fun seekBy(call: PluginCall) = invoke(call, PlaybackContract.SEEK_BY)
    @PluginMethod fun nextChapter(call: PluginCall) = invoke(call, PlaybackContract.NEXT_CHAPTER)
    @PluginMethod fun previousChapter(call: PluginCall) = invoke(call, PlaybackContract.PREVIOUS_CHAPTER)
    @PluginMethod fun setRate(call: PluginCall) = invoke(call, PlaybackContract.SET_RATE)
    @PluginMethod fun setSleepTimer(call: PluginCall) = invoke(call, PlaybackContract.SET_SLEEP_TIMER)
    @PluginMethod fun cancelSleepTimer(call: PluginCall) = invoke(call, PlaybackContract.CANCEL_SLEEP_TIMER)
    @PluginMethod fun adoptPosition(call: PluginCall) = invoke(call, PlaybackContract.ADOPT_POSITION)
    @PluginMethod fun getSnapshot(call: PluginCall) = invoke(call, PlaybackContract.GET_SNAPSHOT)
    @PluginMethod fun drainJournal(call: PluginCall) = invoke(call, PlaybackContract.DRAIN_JOURNAL)
    @PluginMethod fun acknowledgeJournal(call: PluginCall) = invoke(call, PlaybackContract.ACK_JOURNAL)
    @PluginMethod fun setSystemSurfacePrivacy(call: PluginCall) = invoke(call, PlaybackContract.SET_PRIVACY)

    private fun invoke(call: PluginCall, action: String) {
        val controller = controllerFuture
        if (controller == null) {
            call.reject(WovenleafL10n.text("The Android playback service is unavailable."), "ENGINE_UNAVAILABLE")
            return
        }
        val executor = ContextCompat.getMainExecutor(context)
        controller.addListener({
            val mediaController = runCatching { controller.get() }.getOrElse {
                call.reject(
                    WovenleafL10n.text("The Android playback service could not connect."),
                    "ENGINE_UNAVAILABLE",
                    it as? Exception ?: Exception(it),
                )
                return@addListener
            }
            val arguments = Bundle().apply { putString(PlaybackContract.PAYLOAD, call.data.toString()) }
            val resultFuture = mediaController.sendCustomCommand(PlaybackContract.command(action), arguments)
            resultFuture.addListener({
                val result = runCatching { resultFuture.get() }.getOrElse {
                    call.reject(
                        WovenleafL10n.text("The Android playback command failed."),
                        "COMMAND_REJECTED",
                        it as? Exception ?: Exception(it),
                    )
                    return@addListener
                }
                if (result.resultCode != SessionResult.RESULT_SUCCESS) {
                    call.reject(
                        result.extras.getString(PlaybackContract.ERROR_MESSAGE)
                            ?: WovenleafL10n.text("The Android playback command was rejected."),
                        result.extras.getString(PlaybackContract.ERROR_CODE) ?: "COMMAND_REJECTED",
                    )
                    return@addListener
                }
                when (action) {
                    PlaybackContract.ACK_JOURNAL -> call.resolve()
                    PlaybackContract.DRAIN_JOURNAL -> call.resolve(
                        JSObject().put(
                            "events",
                            JSArray(result.extras.getString(PlaybackContract.EVENTS) ?: "[]"),
                        ),
                    )
                    else -> {
                        val raw = result.extras.getString(PlaybackContract.SNAPSHOT)
                        if (raw == null) call.reject(WovenleafL10n.text("Playback returned no authoritative snapshot."), "ENGINE_UNAVAILABLE")
                        else call.resolve(JSObject(raw))
                    }
                }
            }, executor)
        }, executor)
    }

    companion object {
        @Volatile
        private var current: WovenleafPlaybackPlugin? = null

        internal fun emitSnapshot(snapshot: JSObject) {
            current?.notifyListeners("snapshotChanged", snapshot, false)
        }

        internal fun emitEventsAvailable(count: Int) {
            current?.notifyListeners("eventsAvailable", JSObject().put("count", count), false)
        }
    }
}

internal object PlaybackContract {
    const val BRIDGE_VERSION = 1
    const val PREFIX = "com.hmrguez.wovenleaf.playback."
    const val PAYLOAD = "payload"
    const val SNAPSHOT = "snapshot"
    const val EVENTS = "events"
    const val ERROR_CODE = "errorCode"
    const val ERROR_MESSAGE = "errorMessage"

    const val LOAD_QUEUE = "loadQueue"
    const val PLAY = "play"
    const val PAUSE = "pause"
    const val STOP = "stop"
    const val SEEK_ABSOLUTE = "seekToAbsolute"
    const val SEEK_BY = "seekBy"
    const val NEXT_CHAPTER = "nextChapter"
    const val PREVIOUS_CHAPTER = "previousChapter"
    const val SKIP_BACK = "systemSkipBack"
    const val SKIP_FORWARD = "systemSkipForward"
    const val SET_RATE = "setRate"
    const val SET_SLEEP_TIMER = "setSleepTimer"
    const val CANCEL_SLEEP_TIMER = "cancelSleepTimer"
    const val ADOPT_POSITION = "adoptPosition"
    const val GET_SNAPSHOT = "getSnapshot"
    const val DRAIN_JOURNAL = "drainJournal"
    const val ACK_JOURNAL = "acknowledgeJournal"
    const val SET_PRIVACY = "setSystemSurfacePrivacy"

    val actions = listOf(
        LOAD_QUEUE,
        PLAY,
        PAUSE,
        STOP,
        SEEK_ABSOLUTE,
        SEEK_BY,
        NEXT_CHAPTER,
        PREVIOUS_CHAPTER,
        SKIP_BACK,
        SKIP_FORWARD,
        SET_RATE,
        SET_SLEEP_TIMER,
        CANCEL_SLEEP_TIMER,
        ADOPT_POSITION,
        GET_SNAPSHOT,
        DRAIN_JOURNAL,
        ACK_JOURNAL,
        SET_PRIVACY,
    )

    val systemActions = setOf(SKIP_BACK, SKIP_FORWARD, NEXT_CHAPTER, PREVIOUS_CHAPTER)

    fun command(action: String) = SessionCommand(PREFIX + action, Bundle.EMPTY)

    fun capabilities() = JSObject().apply {
        put("bridgeVersion", BRIDGE_VERSION)
        put("engine", "android-media3")
        put("backgroundPlayback", true)
        put("systemControls", true)
        put("processRestoration", true)
        put("systemLibrary", true)
        put("airPlay", false)
        put("cast", false)
        put("routeSelection", true)
        put("sleepTimer", true)
        put("seek", true)
        put("supportedMediaTypes", JSArray(listOf("audio/mpeg", "audio/mp4")))
        put("minimumRate", 0.5)
        put("maximumRate", 3.0)
    }
}
