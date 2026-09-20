package com.hmrguez.wovenleaf

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

/** Temporary FileProvider grants cannot become durable originals; exercise real cold and warm delivery. */
class OpenWithTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val directory get() = File(context.cacheDir, "shared-exports/open-with-test").apply { mkdirs() }
    private var mainScenario: ActivityScenario<MainActivity>? = null

    @Test fun temporaryBookSharesRequireOriginalSelectionWithoutCopying() {
        val fixtures = listOf(
            File(directory, "Temporary.epub").also(::writeEpub),
            File(directory, "Temporary.pdf").also(::writePdf),
            File(directory, "Temporary.mp3").also(::writeMp3),
            File(directory, "Large Temporary.pdf").also(::writeLargePdf),
        )
        try {
            fixtures.forEachIndexed { index, file ->
                if (mainScenario == null) mainScenario = ActivityScenario.launch(intent(file, false))
                else context.startActivity(intent(file, index % 2 == 0))
                val scenario = requireNotNull(mainScenario)
                scenario.onActivity { it.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
                await("original-file recovery") {
                    evaluate(scenario, "document.body.textContent.includes('Choose the original file')") == "true"
                }
                val epubCount = importCount("epub_imports")
                val audioCount = importCount("audiobook_imports")
                assertEquals("Temporary handoffs must not enter the import or player", "false",
                    evaluate(scenario, "Boolean(document.querySelector('.audio-import-commit, .audiobook-player, .incoming-file-opening'))"))
                assertTrue("Do not materialize the shared content in app storage",
                    context.filesDir.walkTopDown().none { it.isFile && it.length() == file.length() && it.readBytes().contentEquals(file.readBytes()) })
                evaluate(scenario, "document.querySelector('[aria-label=\"Close\"]')?.click()")
                await("recovery dismissed") { evaluate(scenario, "!document.body.textContent.includes('Choose the original file')") == "true" }
                assertEquals(epubCount, importCount("epub_imports"))
                assertEquals(audioCount, importCount("audiobook_imports"))
                assertTrue("The sender's original stays intact", file.exists())
            }
        } finally { mainScenario?.close() }
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
