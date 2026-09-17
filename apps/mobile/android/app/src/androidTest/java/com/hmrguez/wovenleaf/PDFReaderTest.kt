package com.hmrguez.wovenleaf

import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Paint
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.MotionEvent
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PDFReaderTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun importFromPickerReadAndResumeOnDevice() {
        val context = instrumentation.targetContext
        val file = File(context.cacheDir, "pdf-reader-verification.pdf")
        writePdf(file)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                await { evaluate(scenario, "Boolean([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings'))") == "true" }
                evaluate(scenario, "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings').click()")
                await { evaluate(scenario, "Boolean(document.querySelector('.epub-picker input'))") == "true" }
                val encoded = Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
                evaluate(scenario, """(() => {
                    const input = document.querySelector('.epub-picker input');
                    const data = new DataTransfer();
                    data.items.add(new File([Uint8Array.from(atob('$encoded'), c => c.charCodeAt(0))], 'PDF reader verification.pdf', {type:'application/pdf'}));
                    input.files = data.files;
                    input.dispatchEvent(new Event('change', {bubbles:true}));
                })()""")
                await { evaluate(scenario, "Boolean(document.querySelector('.epub-import-state.is-complete'))") == "true" }
                val database = SQLiteDatabase.openDatabase(context.getDatabasePath("wovenleafSQLite.db").path, null, SQLiteDatabase.OPEN_READONLY)
                val bookId = database.use { db ->
                    db.rawQuery("SELECT book_id FROM epub_imports WHERE original_name = ? ORDER BY imported_at DESC LIMIT 1", arrayOf("PDF reader verification.pdf")).use {
                        assertTrue(it.moveToFirst()); it.getString(0)
                    }
                }
                fun openReader(): WovenleafPDFActivity {
                    val monitor = instrumentation.addMonitor(WovenleafPDFActivity::class.java.name, null, false)
                    context.startActivity(Intent(context, MainActivity::class.java).apply {
                        action = Intent.ACTION_VIEW
                        data = Uri.parse("wovenleaf://reader?book=${Uri.encode(bookId)}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    })
                    return instrumentation.waitForMonitorWithTimeout(monitor, 20_000) as? WovenleafPDFActivity
                        ?: throw AssertionError("PDF reader did not open after import")
                }
                var reader = openReader()
                await { onMain { labels(reader).any { it.startsWith("Page ") && it.endsWith(" of 4") } } }
                onMain { repeat(3) { control(reader, "Previous page").performClick() } }
                await { onMain { labels(reader).contains("Page 1 of 4") } }
                onMain {
                    val page = views(reader.window.decorView).first { it.contentDescription?.startsWith("PDF page") == true }
                    val before = snapshot(page)
                    val time = SystemClock.uptimeMillis()
                    for (offset in listOf(0L, 80L)) {
                        val down = MotionEvent.obtain(time + offset, time + offset, MotionEvent.ACTION_DOWN, page.width / 2f, page.height / 2f, 0)
                        val up = MotionEvent.obtain(time + offset, time + offset + 30, MotionEvent.ACTION_UP, page.width / 2f, page.height / 2f, 0)
                        page.dispatchTouchEvent(down); page.dispatchTouchEvent(up)
                        down.recycle(); up.recycle()
                    }
                    val zoomed = snapshot(page)
                    assertFalse("Double tap must zoom the rendered PDF", before.sameAs(zoomed))
                    control(reader, "Fit page").performClick()
                    val fitted = snapshot(page)
                    assertTrue("Fit must restore the original page framing", before.sameAs(fitted))
                    before.recycle(); zoomed.recycle(); fitted.recycle()
                    control(reader, "Next page").performClick()
                }
                await { onMain { labels(reader).contains("Page 2 of 4") } }
                onMain { control(reader, "Next page").performClick() }
                await { onMain { labels(reader).contains("Page 3 of 4") } }
                onMain { control(reader, "Fit page").performClick(); control(reader, "Library").performClick() }
                await { reader.isDestroyed }
                // Waiting on the persisted checkpoint verifies native -> durable outbox -> JS -> SQLite.
                await {
                    SQLiteDatabase.openDatabase(context.getDatabasePath("wovenleafSQLite.db").path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                        db.rawQuery("SELECT locator_json FROM epub_reader_checkpoints WHERE book_id = ? ORDER BY recorded_at DESC LIMIT 1", arrayOf(bookId)).use {
                            it.moveToFirst() && JSONObject(it.getString(0)).getJSONObject("locations").getInt("position") == 3
                        }
                    }
                }
                reader = openReader()
                await { onMain { labels(reader).contains("Page 3 of 4") } }
                onMain {
                    val image = snapshot(reader.window.decorView)
                    File(context.cacheDir, "pdf-verification.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    image.recycle()
                }
                onMain { control(reader, "Next page").performClick() }
                await { onMain { labels(reader).contains("Page 4 of 4") && !control(reader, "Next page").isEnabled } }
                onMain { control(reader, "Previous page").performClick() }
                await { onMain { labels(reader).contains("Page 3 of 4") && control(reader, "Next page").isEnabled } }
                onMain { control(reader, "Library").performClick() }
            }
        } finally {
            file.delete()
        }
    }

    private fun writePdf(file: File) {
        val document = PdfDocument()
        try {
            val paint = Paint().apply { textSize = 26f; color = android.graphics.Color.BLACK }
            for (index in 1..4) {
                val page = document.startPage(PdfDocument.PageInfo.Builder(420, 595, index).create())
                page.canvas.drawColor(android.graphics.Color.WHITE)
                page.canvas.drawText("The Quiet Page", 36f, 86f, paint)
                paint.textSize = 16f
                page.canvas.drawText("Page $index of 4", 36f, 130f, paint)
                for (line in 0..12) page.canvas.drawText("A quiet place to read and think.", 36f, 175f + line * 23, paint)
                document.finishPage(page)
            }
            file.outputStream().use(document::writeTo)
        } finally { document.close() }
    }

    private fun evaluate(scenario: ActivityScenario<MainActivity>, script: String): String {
        val latch = CountDownLatch(1)
        var result = ""
        scenario.onActivity { activity ->
            views(activity.window.decorView).filterIsInstance<WebView>().first().evaluateJavascript(script) {
                result = it; latch.countDown()
            }
        }
        assertTrue("JavaScript callback timed out", latch.await(10, TimeUnit.SECONDS))
        return result
    }

    private fun <T> onMain(block: () -> T): T {
        var value: T? = null
        instrumentation.runOnMainSync { value = block() }
        @Suppress("UNCHECKED_CAST") return value as T
    }

    private fun await(ready: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 25_000
        do { if (ready()) return; SystemClock.sleep(100) } while (SystemClock.uptimeMillis() < deadline)
        throw AssertionError("PDF flow did not reach the expected state")
    }

    private fun snapshot(view: View): Bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    private fun labels(activity: WovenleafPDFActivity) = views(activity.window.decorView).filterIsInstance<TextView>().map { it.text.toString() }.toList()
    private fun control(activity: WovenleafPDFActivity, name: String) = views(activity.window.decorView).first { it.contentDescription == name }
    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }
}
