package com.hmrguez.wovenleaf

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

@CapacitorPlugin(name = "WovenleafReader")
class WovenleafReaderPlugin : Plugin() {
    override fun load() {
        current = this
    }

    override fun handleOnDestroy() {
        if (current === this) current = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val bookId = call.getString("bookId")
        val editionId = call.getString("editionId")
        val assetId = call.getString("assetId")
        val fingerprint = call.getString("assetFingerprint")
        val title = call.getString("title")
        val fileUri = call.getString("fileUri")
        if (listOf(bookId, editionId, assetId, fingerprint, title, fileUri).any { it.isNullOrBlank() }) {
            call.reject("The reader capability is invalid.", "INVALID_CAPABILITY")
            return
        }

        val file = fileUri?.let(::managedFile)
        if (file == null) {
            call.reject("The managed EPUB URL is invalid.", "INVALID_CAPABILITY")
            return
        }
        if (!file.isFile) {
            call.reject("The managed EPUB file is missing.", "MISSING_ASSET")
            return
        }

        val intent = Intent(context, WovenleafReaderActivity::class.java).apply {
            putExtra(ReaderContract.BOOK_ID, bookId)
            putExtra(ReaderContract.EDITION_ID, editionId)
            putExtra(ReaderContract.ASSET_ID, assetId)
            putExtra(ReaderContract.ASSET_FINGERPRINT, fingerprint)
            putExtra(ReaderContract.TITLE, title)
            putExtra(ReaderContract.FILE_PATH, file.path)
            putExtra(ReaderContract.LAYOUT, call.getString("layout") ?: "paginated")
            call.getObject("initialLocator")?.let { putExtra(ReaderContract.INITIAL_LOCATOR, it.toString()) }
        }
        activity.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun drainOutbox(call: PluginCall) {
        call.resolve(JSObject().put("events", JSArray(ReaderOutbox.events(context))))
    }

    @PluginMethod
    fun acknowledge(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>()?.toSet() ?: emptySet()
        ReaderOutbox.acknowledge(context, ids)
        call.resolve()
    }

    private fun managedFile(rawUri: String): File? {
        val uri = runCatching { Uri.parse(rawUri) }.getOrNull() ?: return null
        if (uri.scheme != "file") return null
        val candidate = runCatching { File(requireNotNull(uri.path)).canonicalFile }.getOrNull() ?: return null
        // Capacitor maps LibraryNoCloud to the private application files directory on Android.
        val root = context.filesDir.canonicalFile
        return candidate.takeIf { it.path.startsWith(root.path + File.separator) }
    }

    companion object {
        @Volatile
        private var current: WovenleafReaderPlugin? = null

        internal fun emit(event: JSONObject) {
            current?.notifyListeners("readerEvent", JSObject(event.toString()), true)
        }
    }
}

internal object ReaderContract {
    const val BOOK_ID = "reader.bookId"
    const val EDITION_ID = "reader.editionId"
    const val ASSET_ID = "reader.assetId"
    const val ASSET_FINGERPRINT = "reader.assetFingerprint"
    const val TITLE = "reader.title"
    const val FILE_PATH = "reader.filePath"
    const val LAYOUT = "reader.layout"
    const val INITIAL_LOCATOR = "reader.initialLocator"
}

internal data class ReaderContext(
    val bookId: String,
    val editionId: String,
    val assetId: String,
    val assetFingerprint: String,
    val title: String,
    var layout: String,
)

internal object ReaderOutbox {
    private const val PREFERENCES = "wovenleaf.reader"
    private const val EVENTS_KEY = "outbox.v1"
    private const val SEQUENCE_PREFIX = "sequence."

    fun events(context: Context): List<JSONObject> = synchronized(this) {
        val stored = preferences(context).getString(EVENTS_KEY, "[]") ?: "[]"
        val array = runCatching { JSONArray(stored) }.getOrDefault(JSONArray())
        buildList {
            for (index in 0 until array.length()) array.optJSONObject(index)?.let(::add)
        }
    }

    fun enqueue(
        androidContext: Context,
        kind: String,
        readerContext: ReaderContext,
        sessionId: String,
        locator: JSONObject?,
        startedAt: String? = null,
        endedAt: String? = null,
        activeDurationMs: Long? = null,
    ): JSONObject = synchronized(this) {
        val preferences = preferences(androidContext)
        val sequenceKey = SEQUENCE_PREFIX + readerContext.assetId
        val sequence = preferences.getLong(sequenceKey, 0L) + 1L
        val event = JSONObject().apply {
            put("id", "reading-event:reader:${UUID.randomUUID().toString().lowercase()}")
            put("sequence", sequence)
            put("kind", kind)
            put("bookId", readerContext.bookId)
            put("editionId", readerContext.editionId)
            put("assetId", readerContext.assetId)
            put("assetFingerprint", readerContext.assetFingerprint)
            put("sessionId", sessionId)
            put("emittedAt", timestamp())
            put("platform", "android")
            put("toolkitVersion", "3.3.0")
            locator?.let { put("locator", it) }
            startedAt?.let { put("startedAt", it) }
            endedAt?.let { put("endedAt", it) }
            activeDurationMs?.let { put("activeDurationMs", it) }
        }
        val pending = JSONArray().apply { events(androidContext).forEach(::put) }
        pending.put(event)
        preferences.edit()
            .putLong(sequenceKey, sequence)
            .putString(EVENTS_KEY, pending.toString())
            .commit()
        WovenleafReaderPlugin.emit(event)
        event
    }

    fun acknowledge(context: Context, ids: Set<String>) = synchronized(this) {
        if (ids.isEmpty()) return@synchronized
        val remaining = JSONArray().apply {
            events(context).filterNot { ids.contains(it.optString("id")) }.forEach(::put)
        }
        preferences(context).edit().putString(EVENTS_KEY, remaining.toString()).commit()
    }

    fun latestLocator(context: Context, assetId: String): JSONObject? = synchronized(this) {
        events(context).asReversed().firstNotNullOfOrNull { event ->
            if (event.optString("assetId") == assetId) event.optJSONObject("locator") else null
        }
    }

    fun timestamp(): String = Instant.now().toString()

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}
