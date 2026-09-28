package com.hmrguez.wovenleaf

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "WovenleafSnapshot")
class WovenleafSnapshotPlugin : Plugin() {
    private var staged: File? = null
    @PluginMethod fun clearCache(call: PluginCall) {
        if (staged != null) { call.reject("Close the export sheet before erasing private data."); return }
        try {
            val folder = File(context.cacheDir, "shared-exports/snapshots")
            if (folder.exists()) require(folder.deleteRecursively())
            call.resolve()
        } catch (_: Exception) { call.reject("Could not clear temporary images. Please retry.") }
    }
    @PluginMethod fun exportImage(call: PluginCall) {
        if (staged != null) { call.reject("Close the current sheet and retry."); return }
        try {
            val raw = call.getString("png") ?: throw IllegalArgumentException()
            require(raw.length <= 16_000_000)
            val bytes = Base64.decode(raw, Base64.DEFAULT)
            require(bytes.take(8) == listOf(137, 80, 78, 71, 13, 10, 26, 10).map { it.toByte() })
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            require(bounds.outWidth == 1080 && bounds.outHeight in listOf(1080, 1920))
            val action = call.getString("action")
            require(action == "save" || action == "share")
            val folder = File(context.cacheDir, "shared-exports/snapshots").apply { mkdirs() }
            folder.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 30 * 60 * 1000 }?.forEach { require(it.deleteRecursively()) }
            require((folder.listFiles()?.size ?: 0) < 32)
            val exportFolder = File(folder, java.util.UUID.randomUUID().toString()).apply { require(mkdir()) }
            val file = File(exportFolder, "wovenleaf-reading-quarter.png")
            staged = file
            file.outputStream().use { it.write(bytes); it.flush(); it.fd.sync() }
            if (action == "save") {
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE); type = "image/png"
                    putExtra(Intent.EXTRA_TITLE, file.name)
                }
                startActivityForResult(call, intent, "saved")
            } else {
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"; putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri("Reading quarter", uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivityForResult(call, Intent.createChooser(intent, "Share image"), "shared")
            }
        } catch (_: Exception) { cleanup(); call.reject("The image could not be exported. Please retry.") }
    }
    @ActivityCallback private fun saved(call: PluginCall?, result: ActivityResult) {
        if (call == null) { cleanup(); return }
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            cleanup(); call.resolve(JSObject().put("status", "cancelled")); return
        }
        try {
            val file = staged ?: throw IllegalStateException()
            context.contentResolver.openOutputStream(uri, "wt")?.use { output ->
                file.inputStream().use { it.copyTo(output) }; output.flush()
            } ?: throw IllegalStateException()
            cleanup(); call.resolve(JSObject().put("status", "saved"))
        } catch (_: Exception) { cleanup(); call.reject("The image could not be saved. Please retry.") }
    }
    @ActivityCallback private fun shared(call: PluginCall?, result: ActivityResult) {
        // A chooser result does not prove a post. Keep the uniquely addressed file for a bounded handoff period:
        // receiving apps may read asynchronously after the chooser returns.
        staged = null
        call?.resolve(JSObject().put("status", "shared"))
    }
    private fun cleanup() { staged?.parentFile?.deleteRecursively(); staged = null }
}
