package com.hmrguez.wovenleaf

import android.Manifest
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@CapacitorPlugin(name = "WovenleafScanner", permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])])
class WovenleafScannerPlugin : Plugin() {
    private var scanning = false

    @PluginMethod
    fun scan(call: PluginCall) {
        activity.runOnUiThread {
            if (scanning) { call.reject("A scan is already in progress", "BUSY"); return@runOnUiThread }
            scanning = true
            if (getPermissionState("camera") == PermissionState.GRANTED) launchScan(call)
            else requestPermissionForAlias("camera", call, "cameraPermission")
        }
    }

    @PermissionCallback
    private fun cameraPermission(call: PluginCall) {
        if (getPermissionState("camera") == PermissionState.GRANTED) launchScan(call)
        else { scanning = false; call.reject("Camera permission denied", "PERMISSION_DENIED") }
    }

    private fun launchScan(call: PluginCall) {
        try {
            val options = ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.EAN_13)
                .setCaptureActivity(WovenleafScanActivity::class.java)
                .setBeepEnabled(false)
                .setBarcodeImageEnabled(false)
                .setOrientationLocked(false)
                .setPrompt(WovenleafL10n.text("Center the ISBN barcode. Use the torch when the page is dark."))
            startActivityForResult(call, options.createScanIntent(context), "scanResult")
        } catch (_: Exception) {
            scanning = false
            call.reject("Camera unavailable", "UNAVAILABLE")
        }
    }

    @ActivityCallback
    private fun scanResult(call: PluginCall?, result: ActivityResult) {
        scanning = false
        if (call == null) return
        val content = ScanContract().parseResult(result.resultCode, result.data).contents
        call.resolve(JSObject().put("content", content ?: JSObject.NULL))
    }
}
