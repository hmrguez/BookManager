package com.hmrguez.wovenleaf

import android.view.accessibility.AccessibilityManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "WovenleafReviewAccessibility")
class WovenleafReviewAccessibilityPlugin : Plugin() {
    private var manager: AccessibilityManager? = null
    private val listener = AccessibilityManager.TouchExplorationStateChangeListener { publish() }
    private val stateListener = AccessibilityManager.AccessibilityStateChangeListener { publish() }
    override fun load() {
        manager = context.getSystemService(AccessibilityManager::class.java)
        manager?.addTouchExplorationStateChangeListener(listener)
        manager?.addAccessibilityStateChangeListener(stateListener)
    }
    private fun preferences() = JSObject().put("manual",
        manager?.isTouchExplorationEnabled == true || manager?.isEnabled == true ||
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f)
    private fun publish() { notifyListeners("preferencesChanged", preferences()) }
    override fun handleOnResume() { super.handleOnResume(); publish() }
    @PluginMethod fun getPreferences(call: PluginCall) { call.resolve(preferences()) }
    override fun handleOnDestroy() {
        manager?.removeTouchExplorationStateChangeListener(listener)
        manager?.removeAccessibilityStateChangeListener(stateListener)
        super.handleOnDestroy()
    }
}
