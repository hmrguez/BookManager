package com.hmrguez.wovenleaf

import android.app.Activity
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Paint
import android.graphics.Bitmap
import android.graphics.pdf.PdfDocument
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Exercises the real OS file delivery, import, and navigation without resetting the library. */
class OpenWithTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val directory get() = File(context.cacheDir, "shared-exports/open-with-test").apply { mkdirs() }
    private var mainScenario: ActivityScenario<MainActivity>? = null

    @Test fun opensFilesAndReopensManagedBooksWithoutDuplicates() {
        try {
            epubAndPdfOpenAfterColdImportAndWarmShareWithoutDuplicates()
            audioOpensAfterReviewAndReopensWithoutReview()
            largePdfShowsOpeningFeedbackUntilTheReaderOpens()
            invalidFileStaysInImportWithAnError()
        } finally { mainScenario?.close() }
    }

    private fun withMainActivity(file: File, block: (ActivityScenario<MainActivity>) -> Unit) {
        // Keep one bridge/SQLite connection for the flow, just as a real app session does.
        val existing = mainScenario
        if (existing == null) mainScenario = ActivityScenario.launch(intent(file, false))
        else context.startActivity(intent(file, false))
        requireNotNull(mainScenario).onActivity { it.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        block(requireNotNull(mainScenario))
    }

    private fun epubAndPdfOpenAfterColdImportAndWarmShareWithoutDuplicates() {
        for (format in listOf("epub", "pdf")) {
            val file = File(directory, "Open With Verification.$format")
            if (format == "epub") writeEpub(file) else writePdf(file)
            val readerClass = if (format == "epub") WovenleafReaderActivity::class.java else WovenleafPDFActivity::class.java
            var monitor = instrumentation.addMonitor(readerClass.name, null, false)
            try {
                withMainActivity(file) { scenario ->
                    var reader = instrumentation.waitForMonitorWithTimeout(monitor, 30_000)
                        ?: throw AssertionError("$format did not open automatically after import")
                    await("$format reader content") { onMain { views(reader.window.decorView).filterIsInstance<TextView>().any { it.text.toString().contains("Open With") } } }
                    val count = importCount("epub_imports")
                    closeReader(reader)
                    // A renamed copy simulates a second delivery from a different provider URI.
                    val shared = File(directory, "Reopened.$format")
                    file.copyTo(shared, overwrite = true)
                    monitor = instrumentation.addMonitor(readerClass.name, null, false)
                    context.startActivity(intent(shared, true))
                    reader = instrumentation.waitForMonitorWithTimeout(monitor, 30_000)
                        ?: throw AssertionError("$format did not open automatically after repeat share")
                    assertEquals("Reopening must not import another book", count, importCount("epub_imports"))
                    closeReader(reader)
                    monitor = instrumentation.addMonitor(readerClass.name, null, false)
                    context.startActivity(intent(file, false))
                    reader = instrumentation.waitForMonitorWithTimeout(monitor, 30_000)
                        ?: throw AssertionError("$format could not be reopened immediately using the same URI")
                    assertEquals(count, importCount("epub_imports"))
                    closeReader(reader)
                    await("return to library") { evaluate(scenario, "document.querySelector('h1')?.textContent === 'My Books'") == "true" }
                }
            } finally { instrumentation.removeMonitor(monitor) }
        }
    }

    private fun audioOpensAfterReviewAndReopensWithoutReview() {
        val file = File(directory, "Open With Audio.mp3")
        writeMp3(file)
        withMainActivity(file) { scenario ->
            await("audiobook review or existing player") {
                evaluate(scenario, "Boolean(document.querySelector('.audio-import-commit, .audiobook-player'))") == "true"
            }
            evaluate(scenario, "document.querySelector('.audio-import-commit')?.click()")
            await("audiobook player after import") { evaluate(scenario, "Boolean(document.querySelector('.audiobook-player__play'))") == "true" }
            val count = importCount("audiobook_imports")
            evaluate(scenario, "document.querySelector('[aria-label=\"Close\"]')?.click()")
            await("player dismissed") { evaluate(scenario, "!document.querySelector('.audiobook-player')") == "true" }
            val shared = File(directory, "Reopened Audio.mp3")
            file.copyTo(shared, overwrite = true)
            context.startActivity(intent(shared, true))
            await("existing audio opens without review") {
                evaluate(scenario, "Boolean(document.querySelector('.audiobook-player__play')) && !document.querySelector('.audio-import-commit')") == "true"
            }
            assertEquals(count, importCount("audiobook_imports"))
        }
    }

    private fun invalidFileStaysInImportWithAnError() {
        val file = File(directory, "Invalid.epub").apply { writeText("This is not an EPUB") }
        val monitor = instrumentation.addMonitor(WovenleafReaderActivity::class.java.name, null, false)
        try {
            withMainActivity(file) { scenario ->
                await("import error") { evaluate(scenario, "Boolean(document.querySelector('.audiobook-import-state.is-error, .epub-import-state.is-error'))") == "true" }
                assertEquals(0, monitor.hits)
                assertEquals("false", evaluate(scenario, "Boolean(document.querySelector('.audiobook-player'))"))
                assertEquals("false", evaluate(scenario, "Boolean(document.querySelector('.incoming-file-opening'))"))
            }
        } finally { instrumentation.removeMonitor(monitor) }
    }

    private fun largePdfShowsOpeningFeedbackUntilTheReaderOpens() {
        val scenario = requireNotNull(mainScenario)
        val file = File(directory, "Large Illustrated Book.pdf")
        writeLargePdf(file)
        assertTrue("Exercise an actual file larger than 10 MB", file.length() > 10_000_000)
        evaluate(scenario, """
            window.openingPhases = [];
            window.openingObserver = new MutationObserver(() => {
                const dialog = document.querySelector('.incoming-file-opening[open]');
                if (dialog && !window.openingPhases.includes(dialog.dataset.phase)) window.openingPhases.push(dialog.dataset.phase);
            });
            window.openingObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
        """.trimIndent())
        // Both Android Open With and the share sheet must show feedback, including
        // when an already imported large file is opened again.
        for (share in listOf(false, true)) {
            // Hold the provider's first read to check the previously silent gap
            // before any bytes or import-service progress have arrived.
            evaluate(scenario, """
                window.openingPhases = [];
                window.releaseOpeningRead = null;
                window.originalOpeningNativePromise = window.Capacitor.nativePromise;
                window.Capacitor.nativePromise = function(plugin, method, options, ...rest) {
                    if (plugin === 'Filesystem' && method === 'readFile' && options.path.includes('Large')) {
                        window.Capacitor.nativePromise = window.originalOpeningNativePromise;
                        return new Promise((resolve, reject) => {
                            window.releaseOpeningRead = () => window.originalOpeningNativePromise.call(this, plugin, method, options, ...rest).then(resolve, reject);
                        });
                    }
                    return window.originalOpeningNativePromise.call(this, plugin, method, options, ...rest);
                };
            """.trimIndent())
            val monitor = instrumentation.addMonitor(WovenleafPDFActivity::class.java.name, null, false)
            try {
                context.startActivity(intent(file, share))
                await("visible large-file opening feedback") {
                    evaluate(scenario, "Boolean(window.releaseOpeningRead && document.querySelector('.incoming-file-opening[open][data-phase=reading]'))") == "true"
                }
                instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
                    File(directory, "opening-feedback.png").outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    screenshot.recycle()
                }
                evaluate(scenario, "window.releaseOpeningRead()")
                val reader = instrumentation.waitForMonitorWithTimeout(monitor, 60_000)
                    ?: throw AssertionError("Large PDF did not open automatically")
                closeReader(reader)
                await("opening feedback dismissed") {
                    evaluate(scenario, "!document.querySelector('.incoming-file-opening')") == "true"
                }
                assertEquals("[\"reading\",\"preparing\",\"opening\"]", evaluate(scenario, "window.openingPhases"))
            } finally {
                evaluate(scenario, "window.Capacitor.nativePromise = window.originalOpeningNativePromise")
                instrumentation.removeMonitor(monitor)
            }
        }
        evaluate(scenario, "window.openingObserver.disconnect()")
    }

    private fun intent(file: File, share: Boolean): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val mime = when (file.extension) { "pdf" -> "application/pdf"; "epub" -> "application/epub+zip"; else -> "audio/mpeg" }
        return Intent(context, MainActivity::class.java).apply {
            action = if (share) Intent.ACTION_SEND else Intent.ACTION_VIEW
            if (share) { type = mime; putExtra(Intent.EXTRA_STREAM, uri) } else setDataAndType(uri, mime)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun closeReader(reader: Activity) {
        onMain { views(reader.window.decorView).first { it.contentDescription == "Library" || (it is TextView && it.text == "Library") }.performClick() }
        await("reader dismissal") { reader.isDestroyed }
    }

    private fun importCount(table: String): Int = SQLiteDatabase.openDatabase(context.getDatabasePath("wovenleafSQLite.db").path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        db.rawQuery("SELECT COUNT(*) FROM $table", null).use { it.moveToFirst(); it.getInt(0) }
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val latch = CountDownLatch(1)
        var result = ""
        scenario.onActivity { activity ->
            views(activity.window.decorView).filterIsInstance<WebView>().first().evaluateJavascript(script) { result = it; latch.countDown() }
        }
        assertTrue("JavaScript timed out", latch.await(10, TimeUnit.SECONDS))
        return result
    }

    private fun <T> onMain(block: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = block() }
        @Suppress("UNCHECKED_CAST") return result as T
    }

    private fun await(description: String, ready: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 30_000
        do { if (ready()) return; SystemClock.sleep(100) } while (SystemClock.uptimeMillis() < deadline)
        throw AssertionError("Timed out: $description")
    }

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }

    private fun writePdf(file: File) {
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(420, 595, 1).create())
        page.canvas.drawText("Open With PDF Verification", 30f, 70f, Paint().apply { textSize = 22f })
        pdf.finishPage(page)
        file.outputStream().use(pdf::writeTo)
        pdf.close()
    }

    private fun writeLargePdf(file: File) {
        val size = 1900
        val random = java.util.Random(42)
        val pixels = IntArray(size * size) { 0xff000000.toInt() or random.nextInt(0x1000000) }
        val bitmap = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(size, size, 1).create())
        page.canvas.drawBitmap(bitmap, 0f, 0f, null)
        page.canvas.drawText("Open With Large PDF Verification", 40f, 80f, Paint().apply { textSize = 42f })
        pdf.finishPage(page)
        file.outputStream().use(pdf::writeTo)
        pdf.close()
        bitmap.recycle()
    }

    private fun writeEpub(file: File) {
        ZipOutputStream(file.outputStream()).use { zip ->
            fun entry(name: String, text: String) {
                val bytes = text.toByteArray()
                val item = ZipEntry(name).apply {
                    time = 1_700_000_000_000L
                    if (name == "mimetype") { method = ZipEntry.STORED; size = bytes.size.toLong(); crc = java.util.zip.CRC32().apply { update(bytes) }.value }
                }
                zip.putNextEntry(item); zip.write(bytes); zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("book.opf", """<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">open-with-verification</dc:identifier><dc:title>Open With EPUB Verification</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-17T12:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            entry("nav.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Open With</a></li></ol></nav></body></html>""")
            entry("chapter.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Open With</title></head><body><h1>Open With EPUB Verification</h1><p>The book opens directly after import.</p></body></html>""")
        }
    }

    private fun writeMp3(file: File) {
        // MPEG-1 Layer III silent frames, matching the parser's synthetic fixture format.
        val frame = ByteArray(417).apply { this[0] = 0xff.toByte(); this[1] = 0xfb.toByte(); this[2] = 0x90.toByte() }
        file.outputStream().use { output -> repeat(200) { output.write(frame) } }
    }
}
