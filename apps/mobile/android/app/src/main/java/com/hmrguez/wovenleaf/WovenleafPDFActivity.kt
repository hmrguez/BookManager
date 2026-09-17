package com.hmrguez.wovenleaf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.text.InputType
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

class WovenleafPDFActivity : AppCompatActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private var renderer: PdfRenderer? = null // Confined to worker; close is queued after renders.
    private lateinit var readerContext: ReaderContext
    private lateinit var pageView: PDFPageView
    private lateinit var pageLabel: TextView
    private lateinit var previous: TextView
    private lateinit var next: TextView
    private var pageIndex = 0
    private var pageCount = 0
    private var requestedPage = 0
    @Volatile private var generation = 0
    private var active = false
    private var ready = false
    private var sessionStarted: Long? = null
    private var sessionStartedAt = ""
    private var sessionId = ""
    private val paper = Color.rgb(238, 237, 231)
    private val ink = Color.rgb(37, 38, 34)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readerContext = readContext() ?: run { finish(); return }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = true
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(paper) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        top.addView(control("‹ Library", "Library") { finish() })
        top.addView(TextView(this).apply {
            text = readerContext.title; setTextColor(ink); textSize = 14f
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(0, dp(56), 1f))
        top.addView(control("Fit", "Fit page") { pageView.resetZoom() })
        root.addView(top)
        pageView = PDFPageView(this) { direction -> showPage(requestedPage + direction) }
        root.addView(pageView, LinearLayout.LayoutParams(-1, 0, 1f))
        val bottom = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        previous = control("‹", "Previous page") { showPage(requestedPage - 1) }
        next = control("›", "Next page") { showPage(requestedPage + 1) }
        pageLabel = control("Opening PDF…", "Page number") { goToPage() }
        bottom.addView(previous)
        bottom.addView(pageLabel, LinearLayout.LayoutParams(0, dp(56), 1f))
        bottom.addView(next)
        root.addView(bottom)
        setContentView(root)
        val path = intent.getStringExtra(ReaderContract.FILE_PATH)
        val file = path?.let { File(it).canonicalFile }
        if (file == null || !file.path.startsWith(filesDir.canonicalPath + File.separator)) {
            showError(); return
        }
        worker.execute {
            try {
                renderer = PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))
                val count = requireNotNull(renderer).pageCount
                require(count > 0)
                runOnUiThread {
                    if (isDestroyed || isFinishing) return@runOnUiThread
                    pageCount = count
                    val locations = intent.getStringExtra(ReaderContract.INITIAL_LOCATOR)
                        ?.let { JSONObject(it).optJSONObject("locations") }
                    val start = savedInstanceState?.getInt("pdf.page")
                        ?: locations?.takeIf { it.has("position") }?.optInt("position")?.minus(1)
                        ?: (ceil((locations?.optDouble("totalProgression", 0.0) ?: 0.0) * count).toInt() - 1)
                    showPage(start.coerceIn(0, count - 1))
                }
            } catch (_: Exception) { runOnUiThread { showError() } }
        }
    }

    private fun showPage(index: Int) {
        if (index !in 0 until pageCount || worker.isShutdown) return
        requestedPage = index
        val request = ++generation
        worker.execute {
            if (request != generation) return@execute
            try {
                val bitmap = requireNotNull(renderer).openPage(index).use { page -> renderPDFPage(page, 2400) }
                runOnUiThread {
                    if (request != generation || isDestroyed || isFinishing) { bitmap.recycle(); return@runOnUiThread }
                    pageIndex = index
                    pageView.show(bitmap)
                    pageLabel.text = "Page ${index + 1} of $pageCount"
                    pageLabel.contentDescription = "Page ${index + 1} of $pageCount. Go to page"
                    pageView.contentDescription = "PDF page ${index + 1}. Pinch to zoom, swipe to turn pages."
                    previous.isEnabled = index > 0; previous.alpha = if (previous.isEnabled) 1f else 0.3f
                    next.isEnabled = index < pageCount - 1; next.alpha = if (next.isEnabled) 1f else 0.3f
                    ready = true
                    beginSession()
                    emit("location")
                }
            } catch (_: Exception) { runOnUiThread { if (request == generation) showError() } }
        }
    }

    override fun onResume() { super.onResume(); active = true; beginSession() }
    override fun onPause() { endSession(); active = false; super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) { outState.putInt("pdf.page", pageIndex); super.onSaveInstanceState(outState) }
    override fun onDestroy() {
        generation++
        worker.execute { renderer?.close(); renderer = null }
        worker.shutdown()
        if (::pageView.isInitialized) pageView.release()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> { showPage(requestedPage - 1); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> { showPage(requestedPage + 1); return true }
                KeyEvent.KEYCODE_ESCAPE -> { finish(); return true }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun beginSession() {
        if (!active || !ready || sessionStarted != null) return
        sessionId = "reading-session:pdf:${UUID.randomUUID()}"
        sessionStartedAt = ReaderOutbox.timestamp()
        sessionStarted = SystemClock.elapsedRealtime()
        emit("start")
    }

    private fun endSession() {
        val started = sessionStarted ?: return
        emit("session", JSONObject().put("startedAt", sessionStartedAt).put("endedAt", ReaderOutbox.timestamp())
            .put("activeDurationMs", SystemClock.elapsedRealtime() - started))
        sessionStarted = null
    }

    private fun emit(kind: String, extra: JSONObject = JSONObject()) {
        if (!ready || sessionStarted == null) return
        val locator = JSONObject().put("href", "document.pdf").put("type", "application/pdf")
            .put("title", "Page ${pageIndex + 1}").put("locations", JSONObject()
                .put("position", pageIndex + 1).put("pageCount", pageCount)
                .put("totalProgression", (pageIndex + 1).toDouble() / pageCount)
                .put("fragments", JSONArray().put("page=${pageIndex + 1}")))
        extra.put("reachedEnd", pageIndex == pageCount - 1).put("toolkitVersion", "Android PdfRenderer")
        ReaderOutbox.enqueue(this, kind, readerContext, sessionId, locator, extra = extra)
    }

    private fun goToPage() {
        if (pageCount == 0) return
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER; setText((pageIndex + 1).toString()); selectAll()
            contentDescription = "Page number"
        }
        AlertDialog.Builder(this).setTitle("Go to page").setMessage("1–$pageCount").setView(input)
            .setNegativeButton("Cancel", null).setPositiveButton("Go") { _, _ ->
                input.text.toString().toIntOrNull()?.let { showPage((it - 1).coerceIn(0, pageCount - 1)) }
            }.show()
    }

    private fun showError() {
        if (isDestroyed || isFinishing) return
        AlertDialog.Builder(this).setTitle("This PDF couldn’t be opened")
            .setMessage("Choose a readable, unprotected PDF. Your saved position and library are kept.")
            .setPositiveButton("Library") { _, _ -> finish() }.setOnCancelListener { finish() }.show()
    }

    private fun control(label: String, description: String, action: () -> Unit) = TextView(this).apply {
        text = label; contentDescription = description; textSize = 15f; setTextColor(ink)
        gravity = Gravity.CENTER; minWidth = dp(48); minHeight = dp(56)
        setPadding(dp(10), 0, dp(10), 0); isFocusable = true
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

    private fun readContext(): ReaderContext? = runCatching {
        ReaderContext(
            requireNotNull(intent.getStringExtra(ReaderContract.BOOK_ID)),
            requireNotNull(intent.getStringExtra(ReaderContract.EDITION_ID)),
            requireNotNull(intent.getStringExtra(ReaderContract.ASSET_ID)),
            requireNotNull(intent.getStringExtra(ReaderContract.ASSET_FINGERPRINT)),
            requireNotNull(intent.getStringExtra(ReaderContract.TITLE)), null,
            requireNotNull(WovenleafReaderPreferences.fromJson(JSONObject(requireNotNull(intent.getStringExtra(ReaderContract.GLOBAL_PREFERENCES))))), null,
            requireNotNull(ReaderNavigationState.fromJson(JSONObject(requireNotNull(intent.getStringExtra(ReaderContract.NAVIGATION_STATE))))),
            requireNotNull(ReaderAnnotationState.fromJson(JSONObject(requireNotNull(intent.getStringExtra(ReaderContract.ANNOTATION_STATE))))),
        )
    }.getOrNull()
}

internal fun renderPDFPage(page: PdfRenderer.Page, requestedWidth: Int): Bitmap {
    require(page.width > 0 && page.height > 0)
    // Bound allocation even for unusual page aspect ratios and large scans.
    val scale = min(requestedWidth.toDouble() / page.width, sqrt(8_000_000.0 / (page.width.toDouble() * page.height)))
    val bitmap = Bitmap.createBitmap((page.width * scale).roundToInt().coerceAtLeast(1), (page.height * scale).roundToInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    try { page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
    catch (error: Exception) { bitmap.recycle(); throw error }
    return bitmap
}

private class PDFPageView(context: Context, private val turn: (Int) -> Unit) : View(context) {
    private var bitmap: Bitmap? = null
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private var zoom = 1f
    private var panX = 0f
    private var panY = 0f
    private var hadMultiplePointers = false
    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val old = zoom
            zoom = (zoom * detector.scaleFactor).coerceIn(1f, 5f)
            panX = (panX - (detector.focusX - width / 2f)) * (zoom / old) + detector.focusX - width / 2f
            panY = (panY - (detector.focusY - height / 2f)) * (zoom / old) + detector.focusY - height / 2f
            clampPan(); invalidate(); return true
        }
    })
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true
        override fun onSingleTapUp(e: MotionEvent): Boolean { performClick(); return true }
        override fun onDoubleTap(e: MotionEvent): Boolean {
            zoom = if (zoom > 1f) 1f else 2.5f
            panX = (width / 2f - e.x) * (zoom - 1f); panY = (height / 2f - e.y) * (zoom - 1f)
            clampPan(); invalidate(); return true
        }
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            if (zoom > 1f && !scale.isInProgress) { panX -= distanceX; panY -= distanceY; clampPan(); invalidate() }
            return true
        }
        override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
            if (zoom == 1f && !hadMultiplePointers && e1 != null && kotlin.math.abs(e2.x - e1.x) > width * 0.15f && kotlin.math.abs(velocityX) > kotlin.math.abs(velocityY)) {
                turn(if (velocityX < 0) 1 else -1)
            }
            return true
        }
    })

    init { isFocusable = true; isClickable = true; setBackgroundColor(Color.rgb(238, 237, 231)) }
    fun show(value: Bitmap) { bitmap?.recycle(); bitmap = value; resetZoom() }
    fun release() { bitmap?.recycle(); bitmap = null }
    fun resetZoom() { zoom = 1f; panX = 0f; panY = 0f; invalidate() }
    private fun fit(value: Bitmap) = min(width.toFloat() / value.width, height.toFloat() / value.height)
    private fun clampPan() {
        val image = bitmap ?: return
        val x = ((image.width * fit(image) * zoom - width) / 2).coerceAtLeast(0f)
        val y = ((image.height * fit(image) * zoom - height) / 2).coerceAtLeast(0f)
        panX = panX.coerceIn(-x, x); panY = panY.coerceIn(-y, y)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { clampPan() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val image = bitmap ?: return
        val factor = fit(image) * zoom
        canvas.save()
        canvas.translate((width - image.width * factor) / 2 + panX, (height - image.height * factor) / 2 + panY)
        canvas.scale(factor, factor); canvas.drawBitmap(image, 0f, 0f, paint); canvas.restore()
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) hadMultiplePointers = false
        if (event.pointerCount > 1) hadMultiplePointers = true
        scale.onTouchEvent(event); gestures.onTouchEvent(event)
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
