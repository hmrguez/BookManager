package com.hmrguez.wovenleaf

import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.os.Build
import android.os.Vibrator
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.accessibility.AccessibilityManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WovenleafFeedback")
class WovenleafFeedbackPlugin : Plugin() {
    private lateinit var soundPool: SoundPool
    private val soundIds = mutableMapOf<String, Int>()
    private val loadedSoundIds = mutableSetOf<Int>()
    private var activeStreamId = 0

    override fun load() {
        soundPool = SoundPool.Builder()
            .setMaxStreams(1)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            .build()
        soundPool.setOnLoadCompleteListener { _, sampleId, status ->
            if (status == 0) loadedSoundIds += sampleId
        }
        (semanticSounds.values + SHELF_TRANSFER_SOUND).toSet().forEach(::loadSound)
    }

    override fun handleOnDestroy() {
        if (::soundPool.isInitialized) soundPool.release()
        loadedSoundIds.clear()
        soundIds.clear()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val vibrator = context.getSystemService(Vibrator::class.java)
        call.resolve(
            JSObject()
                .put("platform", "android")
                .put("haptics", vibrator?.hasVibrator() == true)
                .put("sound", true),
        )
    }

    @PluginMethod
    fun emit(call: PluginCall) {
        val event = call.getString("event")
        if (event == null || event !in events) {
            call.reject("The feedback event is invalid.", "INVALID_FEEDBACK")
            return
        }
        val hapticsEnabled = call.getBoolean("haptics", false) == true
        val soundEnabled = call.getBoolean("sound", false) == true
        val soundProfile = call.getString("soundProfile", "semantic")

        activity.runOnUiThread {
            val hapticPlayed = hapticsEnabled && playHaptic(event)
            val soundPlayed = soundEnabled && playSound(event, soundProfile)
            call.resolve(
                JSObject()
                    .put("hapticPlayed", hapticPlayed)
                    .put("soundPlayed", soundPlayed),
            )
        }
    }

    private fun playHaptic(event: String): Boolean {
        val constant = when (event) {
            "selection" -> HapticFeedbackConstants.CLOCK_TICK
            "successful-move" -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.GESTURE_END
            } else if (Build.VERSION.SDK_INT >= 27) {
                HapticFeedbackConstants.VIRTUAL_KEY_RELEASE
            } else {
                HapticFeedbackConstants.VIRTUAL_KEY
            }
            "boundary" -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.LONG_PRESS
            }
            "completion" -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.VIRTUAL_KEY
            }
            "error" -> if (Build.VERSION.SDK_INT >= 30) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.LONG_PRESS
            }
            else -> return false
        }
        // No override flags: View policy and the user's global touch-feedback setting stay authoritative.
        return bridge.webView.performHapticFeedback(constant)
    }

    private fun playSound(event: String, profile: String?): Boolean {
        val accessibility = context.getSystemService(AccessibilityManager::class.java)
        if (accessibility?.isTouchExplorationEnabled == true) return false

        val audio = context.getSystemService(AudioManager::class.java)
        if (audio?.isMusicActive == true || audio?.ringerMode != AudioManager.RINGER_MODE_NORMAL) return false
        if (Settings.System.getInt(context.contentResolver, Settings.System.SOUND_EFFECTS_ENABLED, 1) == 0) {
            return false
        }

        val filename = if (profile == "shelf-transfer" && event == "successful-move") {
            SHELF_TRANSFER_SOUND
        } else {
            semanticSounds[event]
        } ?: return false
        val soundId = soundIds[filename]?.takeIf(loadedSoundIds::contains) ?: return false
        if (activeStreamId != 0) soundPool.stop(activeStreamId)
        activeStreamId = soundPool.play(soundId, 1f, 1f, 1, 0, 1f)
        return activeStreamId != 0
    }

    private fun loadSound(filename: String) {
        runCatching {
            context.assets.openFd("public/feedback/$filename").use { descriptor ->
                soundIds[filename] = soundPool.load(descriptor, 1)
            }
        }
    }

    companion object {
        private const val SHELF_TRANSFER_SOUND = "shelf-transfer.wav"
        private val events = setOf("selection", "successful-move", "boundary", "completion", "error")
        private val semanticSounds = mapOf(
            "selection" to "graphite-tick.wav",
            "successful-move" to "paper-slide.wav",
            "boundary" to "paper-edge.wav",
            "completion" to "page-settle.wav",
            "error" to "soft-error.wav",
        )
    }
}
