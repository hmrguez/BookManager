package com.hmrguez.wovenleaf

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

class OriginalFileException(val code: String, message: String = WovenleafL10n.text("Choose the original file again. Your progress is safe.")) : Exception(message)

/** Original provider URIs; persist access when offered, otherwise use the live Open With grant. */
object OriginalFiles {
    private val fingerprints = object : LinkedHashMap<String, String>(128, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 128
    }

    private fun fileVersion(descriptor: ParcelFileDescriptor): String? = runCatching {
        if (android.os.Build.VERSION.SDK_INT < 27) return@runCatching null
        val stat = android.system.Os.fstat(descriptor.fileDescriptor)
        // ctime changes on writes even when a download/transfer preserves a whole-second mtime.
        // Providers with pipes or coarse/unknown change timestamps are always rehashed.
        if (!android.system.OsConstants.S_ISREG(stat.st_mode) || stat.st_ctim.tv_nsec == 0L) return@runCatching null
        "${stat.st_dev}:${stat.st_ino}:${stat.st_size}:${stat.st_mtim.tv_sec}:${stat.st_mtim.tv_nsec}:${stat.st_ctim.tv_sec}:${stat.st_ctim.tv_nsec}"
    }.getOrNull()
    private fun preferences(context: Context) = context.getSharedPreferences("wovenleaf.original-files.v1", Context.MODE_PRIVATE)

    fun register(context: Context, uri: Uri, flags: Int, scope: Uri = uri, relative: String? = null): JSObject {
        if (uri.scheme != "content") throw OriginalFileException("RESELECT_FILE")
        val resolver = context.contentResolver
        if (resolver.persistedUriPermissions.none { it.uri == scope && it.isReadPermission } &&
            flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
            try { resolver.takePersistableUriPermission(scope, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            catch (_: SecurityException) { /* A readable temporary grant can still open this file now. */ }
        }
        val metadata = metadata(context, uri)
        // Query access is not necessarily read access. Never register an unreadable original.
        openDescriptor(context, uri).use { }
        val id = digest(uri.toString().toByteArray())
        preferences(context).edit().putString(id, JSONObject().apply {
            put("uri", uri.toString()); put("scope", scope.toString())
            put("created", System.currentTimeMillis())
        }.toString()).apply()
        return metadata.put("id", id).put("relativePath", relative ?: metadata.getString("name"))
    }

    fun resolve(context: Context, raw: String): Uri {
        val input = Uri.parse(raw)
        if (input.scheme == "wovenleaf-file") {
            val saved = preferences(context).getString(input.host ?: "", null)?.let(::JSONObject)
                ?: throw OriginalFileException("FILE_PERMISSION")
            // The provider is authoritative. A missing persisted grant does not mean a
            // live ACTION_VIEW/ACTION_SEND read grant has expired.
            return Uri.parse(saved.getString("uri"))
        }
        val file = if (input.scheme == "file") input.path?.let(::File)?.canonicalFile
            else if (raw.startsWith("/")) File(raw).canonicalFile else null
        if (file == null || !file.path.startsWith(context.filesDir.canonicalPath + File.separator)) {
            throw OriginalFileException("FILE_PERMISSION")
        }
        return Uri.fromFile(file)
    }

    fun descriptor(context: Context, raw: String): ParcelFileDescriptor {
        return openDescriptor(context, resolve(context, raw))
    }

    private fun openDescriptor(context: Context, uri: Uri): ParcelFileDescriptor {
        return try {
            if (uri.scheme == "file") ParcelFileDescriptor.open(File(requireNotNull(uri.path)), ParcelFileDescriptor.MODE_READ_ONLY)
            else context.contentResolver.openFileDescriptor(uri, "r") ?: throw OriginalFileException("FILE_MISSING")
        } catch (_: SecurityException) { throw OriginalFileException("FILE_PERMISSION") }
        catch (_: java.io.FileNotFoundException) { throw OriginalFileException("FILE_MISSING") }
    }

    fun seekableDescriptor(context: Context, raw: String): ParcelFileDescriptor {
        val descriptor = descriptor(context, raw)
        try { android.system.Os.lseek(descriptor.fileDescriptor, 0, android.system.OsConstants.SEEK_CUR) }
        catch (error: android.system.ErrnoException) {
            descriptor.close()
            throw OriginalFileException("FILE_UNSUPPORTED", WovenleafL10n.text("This provider cannot open PDFs directly. Download the file and choose its local original."))
        }
        return descriptor
    }

    fun stream(context: Context, raw: String): InputStream = ParcelFileDescriptor.AutoCloseInputStream(descriptor(context, raw))

    fun metadata(context: Context, uri: Uri): JSObject {
        if (uri.scheme == "file") {
            val file = File(requireNotNull(uri.path))
            if (!file.isFile || !file.canRead()) throw OriginalFileException("FILE_MISSING")
            return JSObject().put("name", file.name).put("size", file.length()).put("mediaType", "application/octet-stream")
        }
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val name = cursor.getString(0) ?: WovenleafL10n.text("Book")
                    var size = if (cursor.isNull(1)) -1 else cursor.getLong(1)
                    if (size < 0) context.contentResolver.openFileDescriptor(uri, "r")?.use { size = it.statSize }
                    if (size < 0) throw OriginalFileException("FILE_UNSUPPORTED")
                    return JSObject().put("name", name).put("size", size)
                        .put("mediaType", context.contentResolver.getType(uri) ?: "application/octet-stream")
                }
            }
        } catch (_: SecurityException) { throw OriginalFileException("FILE_PERMISSION") }
        throw OriginalFileException("FILE_MISSING")
    }

    fun verify(context: Context, raw: String, expected: String? = null, size: Long? = null, hashContent: Boolean = false): JSObject {
        val metadata = metadata(context, resolve(context, raw))
        if (size != null && metadata.getLong("size") != size) throw OriginalFileException("FILE_CHANGED")
        descriptor(context, raw).use { descriptor ->
            if (expected != null || hashContent) {
                val version = fileVersion(descriptor)
                val key = version?.let { "$raw:$it" }
                val cached = key?.let { synchronized(fingerprints) { fingerprints[it] } }
                val actual = cached ?: ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    val hash = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(1024 * 1024)
                    while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
                    if (version != null && fileVersion(descriptor) != version) throw OriginalFileException("FILE_CHANGED")
                    hex(hash.digest()).also { value -> if (key != null) synchronized(fingerprints) { fingerprints[key] = value } }
                }
                if (expected != null && actual != expected) throw OriginalFileException("FILE_CHANGED")
                metadata.put("fingerprint", actual)
            }
        }
        return metadata
    }

    fun reconcile(context: Context, ids: Set<String>) {
        val prefs = preferences(context)
        val retainedIds = ids.toMutableSet()
        // The native saved queue may still reference the pre-relink source.
        try {
            WovenleafPlaybackJournal(context).use { journal ->
                val sources = journal.state()?.optJSONArray("sources")
                for (index in 0 until (sources?.length() ?: 0)) {
                    val uri = Uri.parse(sources!!.getJSONObject(index).optString("uri"))
                    if (uri.scheme == "wovenleaf-file") uri.host?.let(retainedIds::add)
                }
            }
        } catch (_: Exception) { return }
        val cutoff = System.currentTimeMillis() - 86_400_000
        val retainedScopes = mutableSetOf<String>()
        val removedScopes = mutableSetOf<String>()
        val editor = prefs.edit()
        prefs.all.forEach { (id, value) ->
            val entry = runCatching { JSONObject(value as String) }.getOrNull() ?: return@forEach
            if (id !in retainedIds && entry.optLong("created") < cutoff) {
                editor.remove(id); removedScopes.add(entry.getString("scope"))
            } else retainedScopes.add(entry.getString("scope"))
        }
        editor.apply()
        (removedScopes - retainedScopes).forEach { scope ->
            runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(scope), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        }
    }

    private fun digest(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
}

@CapacitorPlugin(name = "WovenleafFiles")
class WovenleafFilesPlugin : Plugin() {
    override fun load() { current = this }
    override fun handleOnDestroy() { if (current === this) current = null; super.handleOnDestroy() }

    @PluginMethod fun pick(call: PluginCall) {
        val folder = call.getBoolean("folder", false) == true
        val intent = Intent(if (folder) Intent.ACTION_OPEN_DOCUMENT_TREE else Intent.ACTION_OPEN_DOCUMENT).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            if (!folder) {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                putExtra(Intent.EXTRA_MIME_TYPES, if (call.getString("kind") == "audio")
                    arrayOf("audio/*", "application/octet-stream", "application/json", "image/*", "text/plain")
                    else arrayOf("application/epub+zip", "application/pdf"))
            }
        }
        startActivityForResult(call, intent, "picked")
    }

    @ActivityCallback private fun picked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) { call.resolve(JSObject().put("files", JSArray())); return }
        work(call) {
            val data = result.data ?: throw OriginalFileException("FILE_MISSING")
            val uris = data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
                ?: listOfNotNull(data.data)
            val files = JSArray()
            for (uri in uris) {
                if (call.getBoolean("folder", false) == true) {
                    context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    collectFolder(uri, DocumentsContract.getTreeDocumentId(uri), "", call.getString("kind") == "audio", files)
                } else files.put(OriginalFiles.register(context, uri, data.flags))
            }
            JSObject().put("files", files)
        }
    }

    private fun collectFolder(tree: Uri, parent: String, prefix: String, audio: Boolean, files: JSArray) {
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
        context.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getString(0); val name = cursor.getString(1); val type = cursor.getString(2)
                if (name.startsWith(".")) continue
                if (type == DocumentsContract.Document.MIME_TYPE_DIR) { collectFolder(tree, id, "$prefix$name/", audio, files); continue }
                val suffix = name.substringAfterLast('.', "").lowercase()
                val supported = if (audio) setOf("mp3", "m4b", "m4a", "mp4", "cue", "json", "jpg", "jpeg", "png", "gif", "webp", "avif") else setOf("epub", "pdf")
                if (suffix in supported) files.put(OriginalFiles.register(context,
                    DocumentsContract.buildDocumentUriUsingTree(tree, id), 0, tree, "$prefix$name"))
            }
        }
    }

    @PluginMethod fun register(call: PluginCall) = work(call) {
        val raw = call.getString("uri") ?: ""
        if (!raw.startsWith("wovenleaf-file://")) throw OriginalFileException("RESELECT_FILE")
        OriginalFiles.verify(context, raw).put("id", Uri.parse(raw).host)
    }
    @PluginMethod fun stat(call: PluginCall) = work(call) {
        OriginalFiles.verify(context, "wovenleaf-file://" + call.getString("id"), call.getString("fingerprint"), integerArgument(call, "byteSize"), call.getBoolean("hash", false) == true)
    }
    @PluginMethod fun audioDuration(call: PluginCall) = work(call) {
        val raw = "wovenleaf-file://" + call.getString("id")
        OriginalFiles.seekableDescriptor(context, raw).use { descriptor ->
            MediaMetadataRetriever().use { metadata ->
                metadata.setDataSource(descriptor.fileDescriptor)
                val duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                    ?: throw OriginalFileException("FILE_UNSUPPORTED")
                JSObject().put("durationMs", duration)
            }
        }
    }
    @PluginMethod fun read(call: PluginCall) = work(call) {
        val offset = integerArgument(call, "offset") ?: -1
        val length = call.getInt("length") ?: 0
        if (offset < 0 || length !in 1..1024 * 1024) throw OriginalFileException("FILE_UNSUPPORTED")
        OriginalFiles.stream(context, "wovenleaf-file://" + call.getString("id")).use { input ->
            var remaining = offset
            while (remaining > 0) {
                val skipped = input.skip(remaining)
                if (skipped > 0) remaining -= skipped
                else if (input.read() < 0) throw OriginalFileException("FILE_CHANGED") else remaining--
            }
            val bytes = ByteArray(length)
            var total = 0
            while (total < length) { val count = input.read(bytes, total, length - total); if (count < 0) break; total += count }
            JSObject().put("data", Base64.encodeToString(bytes, 0, total, Base64.NO_WRAP))
        }
    }
    @PluginMethod fun reconcile(call: PluginCall) = work(call) {
        OriginalFiles.reconcile(context, call.getArray("ids")?.toList<String>()?.toSet() ?: emptySet()); JSObject()
    }
    @PluginMethod fun incoming(call: PluginCall) {
        synchronized(pending) { call.resolve(JSObject().put("files", JSArray(pending))); pending.clear() }
    }

    private fun work(call: PluginCall, action: () -> JSObject) {
        bridge.execute {
            try { call.resolve(action()) }
            catch (error: Exception) { call.reject(error.message, (error as? OriginalFileException)?.code ?: "FILE_MISSING", error) }
        }
    }

    companion object {
        // Capacitor getLong only accepts boxed Long; JSON uses Integer for values
        // below 2 GiB, including offset zero and most book sizes.
        internal fun integerArgument(call: PluginCall, key: String): Long? {
            if (!call.data.has(key)) return null
            return when (val value = call.data.opt(key)) {
                is Int -> value.toLong()
                is Long -> value
                else -> throw OriginalFileException("FILE_UNSUPPORTED", WovenleafL10n.text("Invalid file offset or size."))
            }
        }

        private var current: WovenleafFilesPlugin? = null
        private val pending = mutableListOf<JSObject>()

        /** Consume book/audio handoffs before the generic share plugin copies them into cache. */
        @JvmStatic fun receive(context: Context, intent: Intent?): Boolean {
            if (intent == null || intent.action !in setOf(Intent.ACTION_VIEW, Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return false
            val uris = intent.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
                ?: if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                else listOfNotNull(intent.data ?: intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            if (uris.isEmpty()) return false
            val items = uris.map { uri ->
                val metadata = runCatching { OriginalFiles.metadata(context, uri) }.getOrNull()
                val name = metadata?.optString("name") ?: uri.lastPathSegment.orEmpty()
                val type = metadata?.optString("mediaType") ?: intent.type.orEmpty()
                val suffix = name.substringAfterLast('.', "").lowercase()
                val ebook = suffix in setOf("epub", "pdf") || type in setOf("application/pdf", "application/epub+zip")
                val audio = suffix in setOf("mp3", "m4b", "m4a", "mp4") || type.startsWith("audio/")
                if (!ebook && !audio) return false
                JSObject().put("name", name).put("kind", if (ebook) "ebook" else "audio").apply {
                    try { put("uri", "wovenleaf-file://" + OriginalFiles.register(context, uri, intent.flags).getString("id")) }
                    catch (_: Exception) { put("needsSelection", true) }
                }
            }
            synchronized(pending) { pending.addAll(items) }
            current?.notifyListeners("incoming", JSObject())
            return true
        }
    }
}
