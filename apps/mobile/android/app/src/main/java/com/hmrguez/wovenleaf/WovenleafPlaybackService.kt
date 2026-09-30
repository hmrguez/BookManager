package com.hmrguez.wovenleaf

import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionResult
import com.getcapacitor.JSObject
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class WovenleafPlaybackService : MediaLibraryService() {
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    private lateinit var journal: WovenleafPlaybackJournal
    private val handler = Handler(Looper.getMainLooper())
    private val engineEpoch = "android-engine:${UUID.randomUUID().toString().lowercase()}"

    private var manifest: JSONObject? = null
    private var sources = JSONArray()
    private var sourceByCapability = emptyMap<String, JSONObject>()
    private var sourceUris = emptyMap<String, Uri>()
    private var artwork: JSONObject? = null
    private var playbackSessionId: String? = null
    private var revision = 0L
    private var sequence = 0L
    private var transportState = "empty"
    private var suppressionReason = "none"
    private var playIntent = false
    private var rate = 1f
    private var lastCommandId: String? = null
    private var playbackError: JSONObject? = null
    private var previewEnabled = false
    private var sleepTimer: JSONObject? = null
    private var sleepRunnable: Runnable? = null
    private var sleepChapterEndMs: Long? = null
    private var activeStartedAt: Long? = null
    private var activeDurationMs = 0L
    private var lastDurableAt = 0L
    private var lastDurablePositionMs = 0L
    private var lastMediaItemIndex = C.INDEX_UNSET
    private var retainedErrorPositionMs: Long? = null
    private var lastPublishedMetadataIdentity: String? = null
    private var pendingTransportChange = false
    private var pendingSeek: Pair<Long, Long>? = null
    private val handledMediaKeyCodes = setOf(
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
        KeyEvent.KEYCODE_MEDIA_REWIND,
    )
    private val supportedArtworkMediaTypes = setOf(
        "image/avif",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
    )

    private val ticker = object : Runnable {
        override fun run() {
            if (manifest != null) {
                val sleepDeadlineReached = sleepTimer
                    ?.optString("deadline")
                    ?.takeIf { it.isNotBlank() }
                    ?.let { runCatching { Instant.parse(it) }.getOrNull() }
                    ?.let { !it.isAfter(Instant.now()) }
                    ?: false
                if (sleepDeadlineReached) {
                    expireSleepTimer()
                    handler.postDelayed(this, 500)
                    return
                }
                if (sleepChapterEndMs?.let { absolutePositionMs() >= it } == true) {
                    expireSleepTimer()
                    handler.postDelayed(this, 500)
                    return
                }
                // Idle queues have no new position to publish. Advancing their
                // revision made a fresh Open With reload race a 500 ms timer,
                // even after completion or a recoverable file-access error.
                if (player.isPlaying || transportState == "buffering" || sleepTimer != null) {
                    revision += 1
                    updateTransportState()
                    refreshMetadata()
                    checkpoint(force = false)
                    emitSnapshot()
                }
            }
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate() {
        WovenleafL10n.initialize(this)
        WovenleafL10n.languageChanged = { handler.post { if (::player.isInitialized && ::session.isInitialized) refreshMetadata(force = true, allItems = true) } }
        super.onCreate()
        journal = WovenleafPlaybackJournal(applicationContext)
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
        player.addListener(PlayerEvents())
        session = MediaLibrarySession.Builder(this, player, SessionCallback())
            .setId("wovenleaf-audiobook-session")
            .setShowPlayButtonIfPlaybackIsSuppressed(true)
            .setPeriodicPositionUpdateEnabled(true)
            .setMediaButtonPreferences(mediaButtonPreferences())
            .build()
        restorePausedQueue()
        handler.post(ticker)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        checkpoint(force = true)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        WovenleafL10n.languageChanged = null
        handler.removeCallbacksAndMessages(null)
        checkpoint(force = true)
        session.release()
        player.release()
        journal.close()
        super.onDestroy()
    }

    private inner class SessionCallback : MediaLibrarySession.Callback {
        override fun onConnect(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            if (controller.packageName != packageName && !controller.isTrusted) {
                return MediaSession.ConnectionResult.reject()
            }
            val defaults = if (controller.packageName == packageName) {
                MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
            } else {
                MediaSession.ConnectionResult.DEFAULT_UNTRUSTED_SESSION_AND_LIBRARY_COMMANDS
            }
            val commands = defaults.buildUpon().apply {
                if (controller.isTrusted || controller.packageName == packageName) {
                    PlaybackContract.actions.forEach { add(PlaybackContract.command(it)) }
                }
            }.build()
            val playerCommands = (
                if (controller.isTrusted || controller.packageName == packageName) {
                    MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
                } else {
                    MediaSession.ConnectionResult.DEFAULT_UNTRUSTED_PLAYER_COMMANDS
                }
            ).buildUpon()
                .remove(Player.COMMAND_SEEK_TO_NEXT)
                .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS)
                .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession, controller)
                .setAvailableSessionCommands(commands)
                .setAvailablePlayerCommands(playerCommands)
                .build()
        }

        override fun onCustomCommand(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            val action = customCommand.customAction.removePrefix(PlaybackContract.PREFIX)
            if (customCommand.customAction == action || action !in PlaybackContract.actions) {
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            val payload = runCatching { JSONObject(args.getString(PlaybackContract.PAYLOAD) ?: "{}") }
                .getOrElse { return Futures.immediateFuture(errorResult("QUEUE_INVALID", WovenleafL10n.text("Playback received invalid command data."))) }
            if (!payload.has("commandId") && action in PlaybackContract.systemActions) {
                return Futures.immediateFuture(handleSystemCommand(action))
            }
            return Futures.immediateFuture(handleCommand(action, payload))
        }

        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun onMediaButtonEvent(
            mediaSession: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent,
        ): Boolean {
            val event = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
            if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) {
                return event.keyCode in handledMediaKeyCodes
            }
            val action = when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_NEXT -> PlaybackContract.NEXT_CHAPTER
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> PlaybackContract.PREVIOUS_CHAPTER
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> PlaybackContract.SKIP_FORWARD
                KeyEvent.KEYCODE_MEDIA_REWIND -> PlaybackContract.SKIP_BACK
                else -> return false
            }
            return handleSystemCommand(action).resultCode == SessionResult.RESULT_SUCCESS
        }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val root = MediaItem.Builder()
                .setMediaId("wovenleaf-root")
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("Wovenleaf")
                        .setIsBrowsable(true)
                        .setIsPlayable(false)
                        .build(),
                )
                .build()
            return Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val items = if (parentId == "wovenleaf-root") mediaItems() else emptyList()
            return Futures.immediateFuture(LibraryResult.ofItemList(items, params))
        }

        @Suppress("OVERRIDE_DEPRECATION")
        override fun onPlaybackResumption(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            val items = mediaItems()
            if (items.isEmpty()) return Futures.immediateFailedFuture(IllegalStateException(WovenleafL10n.text("No saved audiobook queue.")))
            return Futures.immediateFuture(
                MediaSession.MediaItemsWithStartPosition(items, currentSegmentIndex(), segmentPositionMs()),
            )
        }
    }

    private fun handleCommand(action: String, payload: JSONObject): SessionResult {
        if (action == PlaybackContract.GET_SNAPSHOT) return successResult(snapshot())
        if (action == PlaybackContract.DRAIN_JOURNAL) {
            return SessionResult(
                SessionResult.RESULT_SUCCESS,
                Bundle().apply { putString(PlaybackContract.EVENTS, journal.events().toString()) },
            )
        }
        if (action == PlaybackContract.ACK_JOURNAL) {
            val ids = payload.optJSONArray("ids")?.strings()?.toSet() ?: emptySet()
            journal.acknowledge(ids)
            return SessionResult(SessionResult.RESULT_SUCCESS)
        }
        if (action == PlaybackContract.SET_PRIVACY) {
            val next = payload.optBoolean("previewEnabled", false)
            if (previewEnabled == next) return successResult(snapshot())
            previewEnabled = next
            revision += 1
            lastPublishedMetadataIdentity = null
            refreshMetadata(force = true, allItems = true)
            checkpoint(force = true)
            emitSnapshot()
            return successResult(snapshot())
        }

        val commandId = payload.optString("commandId")
        val expectedRevision = payload.optLong("expectedRevision", -1)
        if (commandId.isBlank() || expectedRevision < 0) {
            return errorResult("COMMAND_REJECTED", WovenleafL10n.text("The playback command is invalid."))
        }
        journal.command(commandId)?.let {
            lastCommandId = commandId
            return successResult(snapshot())
        }
        if (expectedRevision != revision) {
            return errorResult("STALE_REVISION", WovenleafL10n.text("Playback changed before this command arrived."))
        }
        return try {
            lastCommandId = commandId
            when (action) {
                PlaybackContract.LOAD_QUEUE -> loadQueue(payload)
                PlaybackContract.PLAY -> play("user-command")
                PlaybackContract.PAUSE -> pause("user-command", clearIntent = true)
                PlaybackContract.STOP -> stop()
                PlaybackContract.SEEK_ABSOLUTE -> seek(payload.optLong("positionMs", 0), "absolute-seek")
                PlaybackContract.SEEK_BY -> seek(absolutePositionMs() + payload.optLong("offsetMs", 0), "relative-seek")
                PlaybackContract.NEXT_CHAPTER -> moveChapter(forward = true)
                PlaybackContract.PREVIOUS_CHAPTER -> moveChapter(forward = false)
                PlaybackContract.SKIP_BACK -> seek(
                    absolutePositionMs() - (manifest?.optJSONObject("skipIntervals")?.optLong("backwardMs") ?: 15_000),
                    "system-command",
                )
                PlaybackContract.SKIP_FORWARD -> seek(
                    absolutePositionMs() + (manifest?.optJSONObject("skipIntervals")?.optLong("forwardMs") ?: 30_000),
                    "system-command",
                )
                PlaybackContract.SET_RATE -> setRate(payload.optDouble("rate", 1.0).toFloat())
                PlaybackContract.SET_SLEEP_TIMER -> setSleepTimer(payload)
                PlaybackContract.CANCEL_SLEEP_TIMER -> cancelSleepTimer()
                PlaybackContract.ADOPT_POSITION -> adoptPosition(payload)
            }
            revision += 1
            checkpoint(force = true)
            val result = snapshot()
            journal.recordCommand(commandId, result, timestamp())
            emitSnapshot(result)
            successResult(result)
        } catch (error: PlaybackCommandException) {
            recordCommandFailure(error)
            errorResult(error.code, error.message ?: WovenleafL10n.text("Playback rejected this command."))
        } catch (_: Throwable) {
            errorResult("COMMAND_REJECTED", WovenleafL10n.text("Playback could not apply this command safely."))
        }
    }

    private fun handleSystemCommand(action: String): SessionResult = try {
        val beforeState = transportState
        val beforeIntent = playIntent
        val beforeSuppression = suppressionReason
        val beforePosition = absolutePositionMs()
        val beforeRate = rate
        lastCommandId = "android-system:${UUID.randomUUID().toString().lowercase()}"
        when (action) {
            PlaybackContract.SKIP_BACK -> seek(
                absolutePositionMs() - (manifest?.optJSONObject("skipIntervals")?.optLong("backwardMs") ?: 15_000),
                "system-command",
            )
            PlaybackContract.SKIP_FORWARD -> seek(
                absolutePositionMs() + (manifest?.optJSONObject("skipIntervals")?.optLong("forwardMs") ?: 30_000),
                "system-command",
            )
            PlaybackContract.NEXT_CHAPTER -> moveChapter(forward = true)
            PlaybackContract.PREVIOUS_CHAPTER -> moveChapter(forward = false)
            else -> return errorResult("COMMAND_REJECTED", WovenleafL10n.text("This system playback command is unavailable."))
        }
        val changed = transportState != beforeState || playIntent != beforeIntent ||
            suppressionReason != beforeSuppression || abs(absolutePositionMs() - beforePosition) > 100 ||
            abs(rate - beforeRate) > 0.001
        if (!changed) return successResult(snapshot())
        revision += 1
        checkpoint(force = true)
        val result = snapshot()
        emitSnapshot(result)
        successResult(result)
    } catch (error: PlaybackCommandException) {
        recordCommandFailure(error)
        errorResult(error.code, error.message ?: WovenleafL10n.text("Playback rejected this system command."))
    }

    private fun loadQueue(payload: JSONObject) {
        val candidateManifest = payload.optJSONObject("manifest")
            ?: throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("The audiobook manifest is missing."))
        val candidateSources = payload.optJSONArray("sources")
            ?: throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("The audiobook source capabilities are missing."))
        val candidateArtwork = payload.optJSONObject("artwork")
        if (candidateManifest.optInt("schemaVersion") != PlaybackContract.BRIDGE_VERSION) {
            throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("This audiobook queue version is unsupported."))
        }
        val segments = candidateManifest.optJSONArray("segments")
            ?: throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("The audiobook queue has no segments."))
        if (segments.length() == 0) throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("The audiobook queue has no segments."))
        val resolved = candidateSources.objects().associateBy { it.optString("capability") }
        val verifiedUris = validateQueue(candidateManifest, resolved)
        player.pause()
        manifest = candidateManifest
        sources = candidateSources
        sourceByCapability = resolved
        sourceUris = verifiedUris
        artwork = validatedArtwork(candidateArtwork)
        lastPublishedMetadataIdentity = null
        playbackSessionId = "playback-session:android:${UUID.randomUUID().toString().lowercase()}"
        playIntent = false
        suppressionReason = "none"
        playbackError = null
        activeDurationMs = 0
        activeStartedAt = null
        retainedErrorPositionMs = null
        rate = candidateManifest.optDouble("rate", 1.0).toFloat().coerceIn(0.5f, 3f)
        player.playbackParameters = PlaybackParameters(rate, 1f)
        val initial = candidateManifest.optLong("initialAbsolutePositionMs", 0)
        val startIndex = segmentIndexForAbsolute(initial)
        player.setMediaItems(mediaItems(), startIndex, initial - segmentStartMs(startIndex))
        player.prepare()
        player.playWhenReady = false
        lastMediaItemIndex = startIndex
        transportState = "paused"
        session.setMediaButtonPreferences(mediaButtonPreferences())
        refreshMetadata(force = true)
    }

    private fun play(reason: String) {
        if (manifest == null || player.mediaItemCount == 0) {
            throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("Load an audiobook before playing."))
        }
        if (playIntent && transportState in setOf("playing", "buffering")) return
        checkOriginalSources()
        val wasPlaying = playIntent
        playIntent = true
        suppressionReason = "none"
        playbackError = null
        player.playbackParameters = PlaybackParameters(rate, 1f)
        pendingTransportChange = true
        if (player.playbackState == Player.STATE_ENDED || absolutePositionMs() >= durationMs()) {
            player.seekTo(0, 0)
        }
        player.play()
        handler.post { pendingTransportChange = false }
        transportState = if (player.playbackState == Player.STATE_BUFFERING) "buffering" else "playing"
        if (!wasPlaying) enqueue(if (reason == "interruption-ended") "resume" else "play", reason)
    }

    private fun pause(reason: String, clearIntent: Boolean) {
        if (!playIntent && !player.isPlaying && transportState == "paused") return
        val before = absolutePositionMs()
        pendingTransportChange = true
        player.pause()
        handler.post { pendingTransportChange = false }
        closeActiveInterval()
        if (clearIntent) playIntent = false
        transportState = if (manifest == null) "empty" else "paused"
        if (reason == "user-command") suppressionReason = "none"
        enqueue("pause", reason, before, absolutePositionMs())
    }

    private fun stop() {
        if (transportState == "stopped") return
        pause("stop", clearIntent = true)
        transportState = if (manifest == null) "empty" else "stopped"
        suppressionReason = "none"
        enqueue("stop", "user-command")
    }

    private fun seek(requestedPositionMs: Long, reason: String) {
        checkOriginalSources()
        if (manifest == null) throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("No audiobook queue is loaded."))
        val before = absolutePositionMs()
        val target = requestedPositionMs.coerceIn(0, max(0, durationMs() - 1))
        if (target == before) return
        val segmentIndex = segmentIndexForAbsolute(target)
        pendingSeek = before to target
        player.seekTo(segmentIndex, target - segmentStartMs(segmentIndex))
        handler.post {
            if (pendingSeek == Pair(before, target)) pendingSeek = null
        }
        enqueue("seek", reason, before, target)
    }

    private fun moveChapter(forward: Boolean) {
        val chapters = manifest?.optJSONArray("chapters")?.objects() ?: return
        val position = absolutePositionMs()
        val target = if (forward) {
            chapters.firstOrNull { it.optLong("absoluteStartMs") > position + 500 }?.optLong("absoluteStartMs")
        } else {
            chapters.lastOrNull { it.optLong("absoluteStartMs") < position - 3_000 }?.optLong("absoluteStartMs") ?: 0
        }
        if (target != null) seek(target, if (forward) "next-chapter" else "previous-chapter")
    }

    private fun setRate(requestedRate: Float) {
        if (requestedRate !in 0.5f..3f) {
            throw PlaybackCommandException("COMMAND_REJECTED", WovenleafL10n.text("The requested playback speed is unsupported."))
        }
        if (abs(requestedRate - rate) < 0.001) return
        val position = absolutePositionMs()
        rate = requestedRate
        player.playbackParameters = PlaybackParameters(rate, 1f)
        enqueue("rate-change", "user-command", position, position)
    }

    private fun setSleepTimer(payload: JSONObject) {
        cancelSleepTimer()
        val mode = if (payload.optString("mode") == "chapter-end") "chapter-end" else "duration"
        val remainingMs = if (mode == "chapter-end") {
            val end = currentChapter()?.optLong("absoluteEndMs") ?: durationMs()
            end - absolutePositionMs()
        } else {
            payload.optLong("durationMs", 0)
        }
        if (remainingMs <= 0) throw PlaybackCommandException("COMMAND_REJECTED", WovenleafL10n.text("The sleep timer duration is invalid."))
        scheduleSleepTimer(mode, remainingMs)
    }

    private fun scheduleSleepTimer(mode: String, remainingMs: Long) {
        sleepRunnable?.let(handler::removeCallbacks)
        sleepRunnable = null
        if (mode == "chapter-end") {
            sleepChapterEndMs = absolutePositionMs() + remainingMs
            sleepTimer = JSONObject().apply {
                put("mode", mode)
                put("remainingMs", remainingMs)
            }
            return
        }
        sleepChapterEndMs = null
        sleepTimer = JSONObject().apply {
            put("mode", mode)
            put("deadline", Instant.now().plusMillis(remainingMs).toString())
            put("remainingMs", remainingMs)
        }
        val runnable = Runnable { expireSleepTimer() }
        sleepRunnable = runnable
        handler.postDelayed(runnable, remainingMs)
    }

    private fun cancelSleepTimer() {
        sleepRunnable?.let(handler::removeCallbacks)
        sleepRunnable = null
        sleepChapterEndMs = null
        sleepTimer = null
    }

    private fun expireSleepTimer() {
        val before = absolutePositionMs()
        player.pause()
        closeActiveInterval()
        playIntent = false
        transportState = "paused"
        suppressionReason = "sleep-timer"
        sleepRunnable = null
        sleepChapterEndMs = null
        sleepTimer = null
        enqueue("sleep-expired", "sleep-timer", before, before)
        revision += 1
        checkpoint(force = true)
        emitSnapshot()
    }

    private fun recordCommandFailure(commandError: PlaybackCommandException) {
        val before = absolutePositionMs()
        player.pause()
        closeActiveInterval()
        playIntent = false
        transportState = "error"
        suppressionReason = "error"
        val code = when (commandError.code) {
            "ENGINE_UNAVAILABLE" -> "engineUnavailable"
            "UNSUPPORTED_ASSET" -> "unsupportedAsset"
            "CORRUPT_ASSET" -> "corruptAsset"
            "RELINK_REQUIRED" -> "relinkRequired"
            "AUTHENTICATION_REQUIRED" -> "authenticationRequired"
            "QUEUE_INVALID" -> "queueInvalid"
            else -> "commandRejected"
        }
        playbackError = JSONObject().apply {
            put("code", code)
            put("message", commandError.message ?: WovenleafL10n.text("Playback rejected this command."))
            put(
                "recoverable",
                code in setOf("engineUnavailable", "relinkRequired", "authenticationRequired", "commandRejected"),
            )
        }
        enqueue("failure", commandError.code.lowercase(), before, absolutePositionMs())
        revision += 1
        checkpoint(force = true)
        emitSnapshot()
    }

    private fun adoptPosition(payload: JSONObject) {
        if (playIntent || transportState in setOf("playing", "buffering")) {
            throw PlaybackCommandException("COMMAND_REJECTED", WovenleafL10n.text("Pause playback before adopting another position."))
        }
        seek(
            payload.optLong("positionMs", 0),
            "adopt:${payload.optString("provenanceEventId", "unknown")}",
        )
    }

    private inner class PlayerEvents : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) {
                transportState = "playing"
                if (activeStartedAt == null) activeStartedAt = SystemClock.elapsedRealtime()
            } else {
                closeActiveInterval()
                updateTransportState()
            }
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            updateTransportState()
            if (playbackState == Player.STATE_ENDED) {
                closeActiveInterval()
                playIntent = false
                transportState = "ended"
                enqueue("end", "queue-ended", durationMs(), durationMs())
            }
            revision += 1
            checkpoint(force = playbackState == Player.STATE_ENDED)
            emitSnapshot()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            val internallyRequested = pendingTransportChange
            if (internallyRequested) pendingTransportChange = false
            val previousIntent = playIntent
            when (reason) {
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> {
                    playIntent = false
                    suppressionReason = "route-lost"
                    enqueue("route-loss", "output-removed")
                }
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> {
                    playIntent = false
                    suppressionReason = "audio-focus-loss"
                    enqueue("interruption", "audio-focus-loss")
                }
                Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST,
                Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> {
                    playIntent = playWhenReady
                    if (!internallyRequested && previousIntent != playWhenReady) {
                        enqueue(
                            if (playWhenReady) "resume" else "pause",
                            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE) {
                                "remote-command"
                            } else {
                                "system-command"
                            },
                        )
                    }
                }
            }
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
            if (playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
                suppressionReason = "audio-focus-loss"
                closeActiveInterval()
            } else if (suppressionReason == "audio-focus-loss" && playIntent) {
                suppressionReason = "none"
            }
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
            if (abs(playbackParameters.speed - rate) < 0.001) return
            val position = absolutePositionMs()
            rate = playbackParameters.speed.coerceIn(0.5f, 3f)
            enqueue("rate-change", "remote-command", position, position)
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val current = player.currentMediaItemIndex
            val changedItem = lastMediaItemIndex != C.INDEX_UNSET && current != lastMediaItemIndex
            if (changedItem) {
                enqueue("segment-transition", "file-boundary")
                lastPublishedMetadataIdentity = null
                handler.post { refreshMetadata(force = true) }
            }
            lastMediaItemIndex = current
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            val before = absolutePosition(oldPosition)
            val after = absolutePosition(newPosition)
            val pending = pendingSeek
            if (pending != null && abs(after - pending.second) <= 100) {
                pendingSeek = null
                return
            }
            if (reason != Player.DISCONTINUITY_REASON_SEEK || before == after) return
            enqueue("seek", "system-command", before, after)
            lastPublishedMetadataIdentity = null
            refreshMetadata(force = true)
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }

        override fun onPlayerError(error: PlaybackException) {
            closeActiveInterval()
            playIntent = false
            transportState = "error"
            suppressionReason = "error"
            val segment = currentSegment()
            playbackError = JSONObject().apply {
                put("code", "playbackFailed")
                put("message", WovenleafL10n.text("Android playback could not continue this segment."))
                put("recoverable", true)
                segment?.optString("playableCapability")?.takeIf(String::isNotBlank)?.let { put("capability", it) }
                segment?.optString("fingerprint")?.takeIf(String::isNotBlank)?.let { put("expectedFingerprint", it) }
            }
            enqueue("failure", "decoder-or-source-error")
            revision += 1
            checkpoint(force = true)
            emitSnapshot()
        }
    }

    private fun mediaItems(): List<MediaItem> {
        val segments = manifest?.optJSONArray("segments")?.objects() ?: return emptyList()
        return segments.mapNotNull { segment ->
            mediaItem(segment, firstChapterForSegment(segment.optString("id")))
        }
    }

    private fun mediaItem(segment: JSONObject, chapter: JSONObject?): MediaItem? {
        val uri = sourceUris[segment.optString("playableCapability")] ?: return null
        return MediaItem.Builder()
            .setMediaId(segment.optString("id"))
            .setUri(uri)
            .setMimeType(segment.optString("mediaType"))
            .setMediaMetadata(systemMetadata(chapter))
            .build()
    }

    private fun systemMetadata(chapter: JSONObject?): MediaMetadata {
        val chapters = manifest?.optJSONArray("chapters")?.objects() ?: emptyList()
        val chapterIndex = chapter?.let { current -> chapters.indexOfFirst { it.optString("key") == current.optString("key") } }
            ?.takeIf { it >= 0 }
        val builder = MediaMetadata.Builder()
            .setTitle(systemTitle())
            .setArtist(systemContributor())
            .setAlbumTitle(if (previewEnabled) previewMetadata()?.optString("series") else null)
            .setSubtitle(if (previewEnabled) chapter?.optString("title") else null)
            .setDurationMs(durationMs())
            .setTrackNumber(if (previewEnabled) chapterIndex?.plus(1) else null)
            .setTotalTrackCount(if (previewEnabled && chapterIndex != null) chapters.size else null)
            .setIsBrowsable(false)
            .setIsPlayable(true)
        if (previewEnabled) artwork?.optString("uri")?.takeIf(String::isNotBlank)?.let {
            builder.setArtworkUri(Uri.parse(it))
        }
        return builder.build()
    }

    private fun mediaButtonPreferences(): List<CommandButton> = listOf(
        CommandButton.Builder(CommandButton.ICON_SKIP_BACK_15)
            .setSessionCommand(PlaybackContract.command(PlaybackContract.SKIP_BACK))
            .setDisplayName(WovenleafL10n.text("Back {{seconds}} seconds", mapOf("seconds" to backwardSkipSeconds().toString())))
            .setEnabled(manifest != null)
            .setSlots(CommandButton.SLOT_BACK)
            .build(),
        CommandButton.Builder(CommandButton.ICON_PREVIOUS)
            .setSessionCommand(PlaybackContract.command(PlaybackContract.PREVIOUS_CHAPTER))
            .setDisplayName(WovenleafL10n.text("Previous chapter"))
            .setEnabled(manifest != null && absolutePositionMs() > 0)
            .setSlots(CommandButton.SLOT_BACK_SECONDARY)
            .build(),
        CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_30)
            .setSessionCommand(PlaybackContract.command(PlaybackContract.SKIP_FORWARD))
            .setDisplayName(WovenleafL10n.text("Forward {{seconds}} seconds", mapOf("seconds" to forwardSkipSeconds().toString())))
            .setEnabled(manifest != null)
            .setSlots(CommandButton.SLOT_FORWARD)
            .build(),
        CommandButton.Builder(CommandButton.ICON_NEXT)
            .setSessionCommand(PlaybackContract.command(PlaybackContract.NEXT_CHAPTER))
            .setDisplayName(WovenleafL10n.text("Next chapter"))
            .setEnabled(hasNextChapter())
            .setSlots(CommandButton.SLOT_FORWARD_SECONDARY)
            .build(),
    )

    private fun refreshMetadata(force: Boolean = false, allItems: Boolean = false) {
        if (manifest == null || player.mediaItemCount == 0) return
        val currentIndex = currentSegmentIndex()
        val segment = currentSegment() ?: return
        val chapter = currentChapter()
        val identity = listOf(
            manifest?.optString("assetId"),
            previewEnabled.toString(),
            if (previewEnabled) chapter?.optString("key") else "private",
            if (previewEnabled) artwork?.optString("fingerprint") else "hidden-artwork",
            (absolutePositionMs() > 0).toString(),
            hasNextChapter().toString(),
        ).joinToString(":")
        if (!force && identity == lastPublishedMetadataIdentity) return
        lastPublishedMetadataIdentity = identity
        if (allItems) {
            player.replaceMediaItems(0, player.mediaItemCount, mediaItems())
        } else {
            val replacement = mediaItem(segment, chapter) ?: return
            player.replaceMediaItem(currentIndex, replacement)
        }
        session.notifyChildrenChanged("wovenleaf-root", player.mediaItemCount, null)
        session.setMediaButtonPreferences(mediaButtonPreferences())
    }

    private fun restorePausedQueue() {
        val saved = journal.state() ?: return
        val savedManifest = saved.optJSONObject("manifest") ?: return
        val savedSources = saved.optJSONArray("sources") ?: return
        val savedSnapshot = saved.optJSONObject("snapshot") ?: return
        runCatching {
            manifest = savedManifest
            sources = savedSources
            sourceByCapability = savedSources.objects().associateBy { it.optString("capability") }
            artwork = validatedArtwork(saved.optJSONObject("artwork"))
            lastPublishedMetadataIdentity = null
            retainedErrorPositionMs = savedSnapshot.optLong("absolutePositionMs", 0)
            playbackSessionId = savedSnapshot.optString("playbackSessionId").takeIf(String::isNotBlank)
            revision = savedSnapshot.optLong("revision", 0) + 1
            sequence = saved.optLong("sequence", 0)
            activeDurationMs = saved.optLong("activeDurationMs", 0)
            previewEnabled = saved.optBoolean("previewEnabled", false)
            rate = savedSnapshot.optDouble("rate", 1.0).toFloat().coerceIn(0.5f, 3f)
            sourceUris = validateQueue(savedManifest, sourceByCapability)
            playIntent = false
            suppressionReason = "process-recreated"
            transportState = "paused"
            player.playbackParameters = PlaybackParameters(rate, 1f)
            val absolute = savedSnapshot.optLong("absolutePositionMs", 0)
            val index = segmentIndexForAbsolute(absolute)
            player.setMediaItems(mediaItems(), index, absolute - segmentStartMs(index))
            player.prepare()
            player.playWhenReady = false
            lastMediaItemIndex = index
            retainedErrorPositionMs = null
            session.setMediaButtonPreferences(mediaButtonPreferences())
            refreshMetadata(force = true)
        }.onFailure {
            transportState = "error"
            suppressionReason = "error"
            playbackError = JSONObject().apply {
                put("code", "relinkRequired")
                put("message", WovenleafL10n.text("A saved audiobook segment is missing or changed. Progress was preserved."))
                put("recoverable", true)
            }
        }
    }

    private fun updateTransportState() {
        transportState = when {
            manifest == null -> "empty"
            playbackError != null -> "error"
            player.playbackState == Player.STATE_ENDED -> "ended"
            player.playbackState == Player.STATE_BUFFERING && playIntent -> "buffering"
            player.isPlaying -> "playing"
            transportState == "stopped" -> "stopped"
            else -> "paused"
        }
    }

    private fun enqueue(
        kind: String,
        reason: String,
        before: Long = absolutePositionMs(),
        after: Long = absolutePositionMs(),
    ) {
        val currentManifest = manifest ?: return
        val currentSession = playbackSessionId ?: return
        closeActiveInterval(commitOnly = true)
        sequence += 1
        val event = JSONObject().apply {
            put("bridgeVersion", PlaybackContract.BRIDGE_VERSION)
            put("id", "playback-event:android:${UUID.randomUUID().toString().lowercase()}")
            put("sequence", sequence)
            put("engineEpoch", engineEpoch)
            put("queueId", currentManifest.optString("queueId"))
            put("playbackSessionId", currentSession)
            put("revision", revision + 1)
            put("kind", kind)
            put("observedAt", timestamp())
            put("activeDurationMs", activeDurationMs)
            put("beforePositionMs", before)
            put("afterPositionMs", after)
            put("rate", rate.toDouble())
            put("reason", reason)
            put("confidence", 1.0)
            put("segmentId", currentSegment()?.optString("id") ?: JSONObject.NULL)
            put("chapterId", currentChapter()?.optString("key") ?: JSONObject.NULL)
            put("error", playbackError ?: JSONObject.NULL)
        }
        journal.enqueue(event, kind in setOf("stop", "end", "failure"))
        WovenleafPlaybackPlugin.emitEventsAvailable(journal.eventCount())
    }

    private fun checkpoint(force: Boolean) {
        val currentManifest = manifest ?: return
        val now = SystemClock.elapsedRealtime()
        val position = absolutePositionMs()
        if (!force && now - lastDurableAt < 10_000 && abs(position - lastDurablePositionMs) < 15_000) return
        closeActiveInterval(commitOnly = true)
        lastDurableAt = now
        lastDurablePositionMs = position
        journal.saveState(JSONObject().apply {
            put("manifest", currentManifest)
            put("sources", sources)
            put("artwork", artwork ?: JSONObject.NULL)
            put("snapshot", snapshot())
            put("previewEnabled", previewEnabled)
            put("sequence", sequence)
            put("activeDurationMs", activeDurationMs)
        })
    }

    private fun closeActiveInterval(commitOnly: Boolean = false) {
        activeStartedAt?.let { started ->
            activeDurationMs += max(0, SystemClock.elapsedRealtime() - started)
            activeStartedAt = if (commitOnly && playIntent && player.isPlaying) SystemClock.elapsedRealtime() else null
        }
    }

    private fun snapshot(): JSONObject = JSONObject().apply {
        put("bridgeVersion", PlaybackContract.BRIDGE_VERSION)
        put("engineEpoch", engineEpoch)
        put("queueId", manifest?.optString("queueId") ?: JSONObject.NULL)
        put("playbackSessionId", playbackSessionId ?: JSONObject.NULL)
        put("revision", revision)
        put("state", transportState)
        put("suppressionReason", suppressionReason)
        put("playIntent", playIntent)
        put("segmentId", currentSegment()?.optString("id") ?: JSONObject.NULL)
        put("chapterId", currentChapter()?.optString("key") ?: JSONObject.NULL)
        put("absolutePositionMs", absolutePositionMs())
        put("segmentPositionMs", segmentPositionMs())
        put("durationMs", durationMs())
        put("bufferedPositionMs", min(durationMs(), segmentStartMs(currentSegmentIndex()) + player.bufferedPosition))
        put("activeDurationMs", currentActiveDurationMs())
        put("rate", rate.toDouble())
        put("sleepTimer", sleepTimerSnapshot() ?: JSONObject.NULL)
        put("route", routeSummary())
        put("capabilities", PlaybackContract.capabilities())
        put("lastCommandId", lastCommandId ?: JSONObject.NULL)
        put("error", playbackError ?: JSONObject.NULL)
        put("observedAt", timestamp())
    }

    private fun emitSnapshot(value: JSONObject = snapshot()) {
        WovenleafPlaybackPlugin.emitSnapshot(JSObject(value.toString()))
    }

    private fun currentActiveDurationMs(): Long {
        val started = activeStartedAt ?: return activeDurationMs
        return activeDurationMs + max(0, SystemClock.elapsedRealtime() - started)
    }

    private fun routeSummary(): JSONObject {
        val audio = getSystemService(AudioManager::class.java)
        val route = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).minByOrNull { routePriority(it.type) }
        val remote = player.deviceInfo.playbackType == androidx.media3.common.DeviceInfo.PLAYBACK_TYPE_REMOTE
        val kind = when {
            remote -> "cast"
            route?.type in setOf(
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_USB_ACCESSORY,
                AudioDeviceInfo.TYPE_LINE_ANALOG,
                AudioDeviceInfo.TYPE_LINE_DIGITAL,
                AudioDeviceInfo.TYPE_AUX_LINE,
            ) -> "wired"
            route?.type in setOf(
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLE_HEADSET,
                AudioDeviceInfo.TYPE_BLE_SPEAKER,
                AudioDeviceInfo.TYPE_HEARING_AID,
            ) -> "bluetooth"
            route?.type in setOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) -> "built-in"
            else -> if (remote) "cast" else "unknown"
        }
        val external = kind !in setOf("built-in", "unknown")
        return JSONObject().apply {
            put("kind", kind)
            put("name", route?.productName?.toString()?.takeIf(String::isNotBlank) ?: WovenleafL10n.text("Android audio"))
            put("external", external)
        }
    }

    private fun routePriority(type: Int): Int = when (type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLE_SPEAKER,
        AudioDeviceInfo.TYPE_HEARING_AID,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_ACCESSORY,
        AudioDeviceInfo.TYPE_LINE_ANALOG,
        AudioDeviceInfo.TYPE_LINE_DIGITAL,
        AudioDeviceInfo.TYPE_AUX_LINE -> 0
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> 1
        else -> 2
    }

    private fun sleepTimerSnapshot(): JSONObject? {
        val current = sleepTimer ?: return null
        sleepChapterEndMs?.let { chapterEnd ->
            return JSONObject(current.toString()).apply {
                put("remainingMs", max(0, chapterEnd - absolutePositionMs()))
            }
        }
        val deadline = runCatching { Instant.parse(current.optString("deadline")) }.getOrNull() ?: return current
        return JSONObject(current.toString()).apply {
            put("remainingMs", max(0, deadline.toEpochMilli() - Instant.now().toEpochMilli()))
        }
    }

    private fun absolutePositionMs(): Long = retainedErrorPositionMs ?: if (player.playbackState == Player.STATE_ENDED) durationMs() else min(
        durationMs(),
        max(0, segmentStartMs(currentSegmentIndex()) + player.currentPosition),
    )

    private fun segmentPositionMs(): Long = retainedErrorPositionMs?.let {
        max(0, it - segmentStartMs(segmentIndexForAbsolute(it)))
    } ?: max(0, player.currentPosition)

    private fun durationMs(): Long = manifest
        ?.optJSONArray("segments")
        ?.optJSONObject((manifest?.optJSONArray("segments")?.length() ?: 1) - 1)
        ?.optLong("absoluteEndMs")
        ?: 0

    private fun currentSegmentIndex(): Int = player.currentMediaItemIndex.takeIf { it >= 0 } ?: 0

    private fun segmentStartMs(index: Int): Long = manifest
        ?.optJSONArray("segments")
        ?.optJSONObject(index.coerceAtLeast(0))
        ?.optLong("absoluteStartMs")
        ?: 0

    private fun segmentIndexForAbsolute(positionMs: Long): Int {
        val segments = manifest?.optJSONArray("segments")?.objects() ?: return 0
        return segments.indexOfFirst {
            positionMs >= it.optLong("absoluteStartMs") && positionMs < it.optLong("absoluteEndMs")
        }.takeIf { it >= 0 } ?: max(0, segments.size - 1)
    }

    private fun currentSegment(): JSONObject? = manifest
        ?.optJSONArray("segments")
        ?.optJSONObject(currentSegmentIndex())

    private fun currentChapter(): JSONObject? {
        val position = absolutePositionMs()
        return manifest?.optJSONArray("chapters")?.objects()?.firstOrNull {
            position >= it.optLong("absoluteStartMs") && position < it.optLong("absoluteEndMs")
        }
    }

    private fun firstChapterForSegment(segmentId: String): JSONObject? = manifest
        ?.optJSONArray("chapters")
        ?.objects()
        ?.firstOrNull { it.optString("segmentId") == segmentId }

    private fun hasNextChapter(): Boolean {
        val position = absolutePositionMs()
        return manifest?.optJSONArray("chapters")?.objects()?.any {
            it.optLong("absoluteStartMs") > position + 500
        } == true
    }

    private fun backwardSkipSeconds(): Long = max(
        1,
        (manifest?.optJSONObject("skipIntervals")?.optLong("backwardMs") ?: 15_000) / 1_000,
    )

    private fun forwardSkipSeconds(): Long = max(
        1,
        (manifest?.optJSONObject("skipIntervals")?.optLong("forwardMs") ?: 30_000) / 1_000,
    )

    private fun absolutePosition(position: Player.PositionInfo): Long {
        val index = position.mediaItemIndex.takeIf { it >= 0 } ?: return absolutePositionMs()
        return min(durationMs(), max(0, segmentStartMs(index) + position.positionMs))
    }

    private fun previewMetadata(): JSONObject? = manifest?.optJSONObject("systemSurfaceMetadata")?.optJSONObject("preview")
    private fun privateMetadata(): JSONObject? = manifest?.optJSONObject("systemSurfaceMetadata")?.optJSONObject("private")
    private fun systemTitle() = if (previewEnabled) previewMetadata()?.optString("title") else privateMetadata()?.optString("title")
    private fun systemContributor() = if (previewEnabled) previewMetadata()?.optString("contributor") else WovenleafL10n.text("Audiobook")

    private fun validatedArtwork(candidate: JSONObject?): JSONObject? {
        candidate ?: return null
        if (candidate.optString("mediaType") !in supportedArtworkMediaTypes) return null
        val file = managedFile(candidate.optString("uri")) ?: return null
        if (
            !file.isFile || !file.canRead() || file.length() != candidate.optLong("byteSize") ||
            sha256(file) != candidate.optString("fingerprint")
        ) return null
        return JSONObject(candidate.toString())
    }

    private fun managedFile(rawUri: String): File? {
        val uri = runCatching { Uri.parse(rawUri) }.getOrNull() ?: return null
        if (uri.scheme != "file") return null
        val candidate = runCatching { File(requireNotNull(uri.path)).canonicalFile }.getOrNull() ?: return null
        val root = filesDir.canonicalFile
        return candidate.takeIf { it.path.startsWith(root.path + File.separator) }
    }

    private fun validateQueue(candidateManifest: JSONObject, resolved: Map<String, JSONObject>): Map<String, Uri> {
        val verifiedUris = mutableMapOf<String, Uri>()
        val segments = candidateManifest.optJSONArray("segments")?.objects()
            ?: throw PlaybackCommandException("QUEUE_INVALID", WovenleafL10n.text("The audiobook queue has no segments."))
        segments.forEach { segment ->
            val capability = segment.optString("playableCapability")
            val source = resolved[capability]
                ?: throw PlaybackCommandException("RELINK_REQUIRED", WovenleafL10n.text("A managed audiobook segment is unavailable."))
            if (source.optString("fingerprint") != segment.optString("fingerprint") || source.optString("mediaType") != segment.optString("mediaType")) {
                throw PlaybackCommandException("RELINK_REQUIRED", WovenleafL10n.text("An audiobook file has changed. Choose it again; progress is safe."))
            }
            try {
                OriginalFiles.verify(this, source.optString("uri"), source.optString("fingerprint"), source.optLong("byteSize"))
                verifiedUris[capability] = OriginalFiles.resolve(this, source.optString("uri"))
            } catch (_: Exception) {
                throw PlaybackCommandException("RELINK_REQUIRED", WovenleafL10n.text("An audiobook file is unavailable or changed. Choose it again; progress is safe."))
            }
        }
        return verifiedUris
    }

    private fun checkOriginalSources() {
        try {
            sourceByCapability.values.filter { it.optString("uri").startsWith("wovenleaf-file://") }.forEach {
                OriginalFiles.verify(this, it.optString("uri"), size = it.optLong("byteSize"))
            }
        } catch (_: Exception) {
            throw PlaybackCommandException("RELINK_REQUIRED", WovenleafL10n.text("An original audiobook file is unavailable. Choose it again; progress is safe."))
        }
    }

    private fun sha256(file: File): String = runCatching {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(1_048_576)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }.getOrElse { "" }

    private fun successResult(snapshot: JSONObject) = SessionResult(
        SessionResult.RESULT_SUCCESS,
        Bundle().apply { putString(PlaybackContract.SNAPSHOT, snapshot.toString()) },
    )

    private fun errorResult(code: String, message: String) = SessionResult(
        SessionResult.RESULT_ERROR_BAD_VALUE,
        Bundle().apply {
            putString(PlaybackContract.ERROR_CODE, code)
            putString(PlaybackContract.ERROR_MESSAGE, message)
        },
    )

    private class PlaybackCommandException(val code: String, message: String) : IllegalStateException(message)
}

private fun JSONArray.objects(): List<JSONObject> = buildList {
    for (index in 0 until length()) optJSONObject(index)?.let(::add)
}

private fun JSONArray.strings(): List<String> = buildList {
    for (index in 0 until length()) optString(index).takeIf(String::isNotBlank)?.let(::add)
}

private fun timestamp(): String = Instant.now().toString()
