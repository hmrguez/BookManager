package com.hmrguez.wovenleaf

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.util.Url
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ReaderPagingTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun liveDragCancellationAndFinalPageCompletion() {
        val context = instrumentation.targetContext
        val assetId = "reader-paging-test:${UUID.randomUUID()}"
        val file = File(context.cacheDir, "$assetId.epub")
        writeBook(file)
        val state = JSONObject().put("version", 1).put("bookId", assetId).put("editionId", assetId)
            .put("updatedAt", "2026-09-07T12:00:00Z")
            .put("bookmarks", JSONArray()).put("annotations", JSONArray())
        val intent = Intent(context, WovenleafReaderActivity::class.java).apply {
            putExtra(ReaderContract.BOOK_ID, assetId)
            putExtra(ReaderContract.EDITION_ID, assetId)
            putExtra(ReaderContract.ASSET_ID, assetId)
            putExtra(ReaderContract.ASSET_FINGERPRINT, "a".repeat(64))
            putExtra(ReaderContract.TITLE, "Paging regression")
            putExtra(ReaderContract.FILE_PATH, file.path)
            putExtra(ReaderContract.GLOBAL_PREFERENCES, WovenleafReaderPreferences().toJson().toString())
            putExtra(ReaderContract.NAVIGATION_STATE, state.toString())
            putExtra(ReaderContract.ANNOTATION_STATE, state.toString())
        }
        try {
            ActivityScenario.launch<WovenleafReaderActivity>(intent).use { scenario ->
                awaitState(scenario) { activity ->
                    views(activity.window.decorView).filterIsInstance<TextView>().any { it.text == "0%" }
                }
                val rect = Rect()
                var originalScroll = 0
                scenario.onActivity { activity ->
                    val webView = visibleWebView(activity)
                    webView.getGlobalVisibleRect(rect)
                    originalScroll = webView.scrollX
                }
                val down = SystemClock.uptimeMillis()
                val x = rect.left + rect.width() * 0.72f
                val y = rect.top + rect.height() * 0.5f
                pointer(scenario, down, MotionEvent.ACTION_DOWN, x, y)
                for (step in 1..12) {
                    SystemClock.sleep(20)
                    pointer(scenario, down, MotionEvent.ACTION_MOVE, x - rect.width() * 0.4f * step / 12, y)
                }
                // This assertion happens before finger-up: content must already
                // be moving inside the WebView, not just in a shell animation.
                scenario.onActivity { activity ->
                    assertTrue("Incoming content must be revealed during the drag",
                        visibleWebView(activity).scrollX > originalScroll + rect.width() / 5)
                }
                pointer(scenario, down, MotionEvent.ACTION_CANCEL, x - rect.width() * 0.4f, y)
                awaitState(scenario) { kotlin.math.abs(visibleWebView(it).scrollX - originalScroll) < 2 }

                // An ordinary chapter's final page must still allow forward navigation.
                scenario.onActivity { activity ->
                    val navigator = navigator(activity)
                    navigator.go(navigator.currentLocator.value.copy(locations = Locator.Locations(progression = 1.0)), false)
                }
                awaitState(scenario) { navigator(it).currentLocator.value.locations.progression!! > 0.8 }
                scenario.onActivity { activity ->
                    assertTrue(control(activity, "Next page").isEnabled)
                    assertFalse(views(activity.window.decorView).filterIsInstance<TextView>().any { it.text == "100%" })
                    val navigator = navigator(activity)
                    assertTrue(navigator.go(navigator.currentLocator.value.copy(
                        href = requireNotNull(Url(navigator.currentLocator.value.href.toString().replace("one.xhtml", "two.xhtml"))),
                        locations = Locator.Locations(progression = 1.0),
                    ), false))
                }
                awaitState(scenario) { !control(it, "Next page").isEnabled }
                var finalLocator: Locator? = null
                scenario.onActivity { activity ->
                    finalLocator = navigator(activity).currentLocator.value
                    assertTrue(finalLocator!!.locations.totalProgression!! < 1.0)
                    assertTrue(views(activity.window.decorView).filterIsInstance<TextView>().any { it.text == "100%" })
                }
                repeat(3) {
                    scenario.onActivity {
                        it.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_RIGHT))
                        it.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_RIGHT))
                    }
                }
                SystemClock.sleep(300)
                scenario.onActivity { assertEquals(finalLocator, navigator(it).currentLocator.value) }
                awaitState(scenario) {
                    ReaderOutbox.events(context).any { it.optString("assetId") == assetId && it.optBoolean("reachedEnd") }
                }
                scenario.onActivity { control(it, "Previous page").performClick() }
                awaitState(scenario) { control(it, "Next page").isEnabled }
                scenario.onActivity { activity ->
                    assertFalse(views(activity.window.decorView).filterIsInstance<TextView>().any { it.text == "100%" })
                    control(activity, "Next page").performClick()
                }
                awaitState(scenario) { !control(it, "Next page").isEnabled }
            }
        } finally {
            file.delete()
            ReaderOutbox.acknowledge(context, ReaderOutbox.events(context)
                .filter { it.optString("assetId") == assetId }.map { it.getString("id") }.toSet())
        }
    }

    private fun pointer(scenario: ActivityScenario<WovenleafReaderActivity>, down: Long, action: Int, x: Float, y: Float) {
        // Dispatch through the real activity hierarchy while avoiding unrelated
        // emulator windows stealing system-level injected input.
        scenario.onActivity { activity ->
            val offset = IntArray(2)
            activity.window.decorView.getLocationOnScreen(offset)
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x - offset[0], y - offset[1], 0)
            try { activity.dispatchTouchEvent(event) } finally { event.recycle() }
        }
    }

    private fun awaitState(scenario: ActivityScenario<WovenleafReaderActivity>, ready: (WovenleafReaderActivity) -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        do {
            var satisfied = false
            scenario.onActivity { satisfied = ready(it) }
            if (satisfied) return
            SystemClock.sleep(50)
        } while (SystemClock.uptimeMillis() < deadline)
        var state = ""
        scenario.onActivity { activity ->
            state = navigator(activity).currentLocator.value.toJSON().toString() +
                " next=" + control(activity, "Next page").isEnabled +
                " labels=" + views(activity.window.decorView).filterIsInstance<TextView>().map { it.text }.toList()
        }
        throw AssertionError("Reader did not reach the expected state: $state")
    }

    private fun navigator(activity: WovenleafReaderActivity) =
        activity.supportFragmentManager.findFragmentByTag("epub-navigator") as EpubNavigatorFragment

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }

    private fun visibleWebView(activity: WovenleafReaderActivity) = views(activity.window.decorView)
        .filterIsInstance<WebView>().first { it.getGlobalVisibleRect(Rect()) }

    private fun control(activity: WovenleafReaderActivity, label: String) =
        views(activity.window.decorView).first { it.contentDescription == label }

    // Original test prose; no external book or fixture download is needed.
    private fun writeBook(file: File) {
        ZipOutputStream(file.outputStream()).use { zip ->
            fun entry(name: String, text: String) {
                val bytes = text.toByteArray()
                val item = ZipEntry(name)
                if (name == "mimetype") {
                    item.method = ZipEntry.STORED
                    item.size = bytes.size.toLong()
                    item.crc = java.util.zip.CRC32().apply { update(bytes) }.value
                }
                zip.putNextEntry(item)
                zip.write(bytes)
                zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("book.opf", """<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">paging-test</dc:identifier><dc:title>Paging regression</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-07T12:00:00Z</meta></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>""")
            entry("nav.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>""")
            for (chapter in listOf("one", "two")) {
                val paragraphs = (1..100).joinToString("") { "<p>Passage $it. The quiet library opened onto a garden. Every page held a different thought, and the reader took time to consider each one before continuing.</p>" }
                entry("$chapter.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>$chapter</title></head><body><h1>$chapter</h1>$paragraphs</body></html>""")
            }
        }
    }
}
