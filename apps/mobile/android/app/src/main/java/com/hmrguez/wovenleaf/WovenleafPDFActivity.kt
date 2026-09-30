package com.hmrguez.wovenleaf

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.SystemClock
import android.text.InputType
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewConfiguration
import android.view.animation.DecelerateInterpolator
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
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.abs
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
    private lateinit var fitButton: TextView
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
        top.addView(control("‹ Library", WovenleafL10n.text("Library")) { finish() })
        top.addView(TextView(this).apply {
            text = readerContext.title; setTextColor(ink); textSize = 14f
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(0, dp(56), 1f))
        fitButton = control(WovenleafL10n.text("Fit"), WovenleafL10n.text("Fit page")) { pageView.resetZoom() }.apply { visibility = View.INVISIBLE }
        top.addView(fitButton)
        root.addView(top)
        pageView = PDFPageView(this,
            turn = { direction -> showPage(pageIndex + direction) },
            fitChanged = { fitted -> fitButton.visibility = if (fitted) View.INVISIBLE else View.VISIBLE },
        )
        root.addView(pageView, LinearLayout.LayoutParams(-1, 0, 1f))
        val bottom = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        previous = control("‹", WovenleafL10n.text("Previous page")) { showPage(requestedPage - 1) }
        next = control("›", WovenleafL10n.text("Next page")) { showPage(requestedPage + 1) }
        pageLabel = control(WovenleafL10n.text("Opening PDF…"), WovenleafL10n.text("Page number")) { goToPage() }
        bottom.addView(previous)
        bottom.addView(pageLabel, LinearLayout.LayoutParams(0, dp(56), 1f))
        bottom.addView(next)
        root.addView(bottom)
        setContentView(root)
        val path = intent.getStringExtra(ReaderContract.FILE_PATH)
        if (path == null) { showError(); return }
        worker.execute {
            try {
                renderer = openOriginalPDF(this, path)
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
            } catch (error: Exception) { runOnUiThread { showError(error) } }
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
                    pageLabel.text = WovenleafL10n.text("Page {{page}} of {{total}}", mapOf("page" to (index + 1).toString(), "total" to pageCount.toString()))
                    pageLabel.contentDescription = WovenleafL10n.text("Page {{page}} of {{total}}. Go to page", mapOf("page" to (index + 1).toString(), "total" to pageCount.toString()))
                    pageView.contentDescription = WovenleafL10n.text("PDF page {{page}}. Pinch to zoom, swipe to turn pages.", mapOf("page" to (index + 1).toString()))
                    previous.isEnabled = index > 0; previous.alpha = if (previous.isEnabled) 1f else 0.3f
                    next.isEnabled = index < pageCount - 1; next.alpha = if (next.isEnabled) 1f else 0.3f
                    ready = true
                    beginSession()
                    emit("location")
                }
                // Only two bounded previews are retained. They are ready before a
                // drag, while the full-resolution current page remains zoomable.
                for (direction in listOf(-1, 1)) {
                    val neighbor = index + direction
                    if (neighbor !in 0 until pageCount || request != generation) continue
                    val preview = runCatching {
                        requireNotNull(renderer).openPage(neighbor).use { renderPDFPage(it, 1200, 2_000_000) }
                    }.getOrNull() ?: continue
                    runOnUiThread {
                        if (request != generation || isDestroyed || isFinishing) preview.recycle()
                        else pageView.preview(direction, preview)
                    }
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
            contentDescription = WovenleafL10n.text("Page number")
        }
        AlertDialog.Builder(this).setTitle(WovenleafL10n.text("Go to page")).setMessage("1–$pageCount").setView(input)
            .setNegativeButton(WovenleafL10n.text("Cancel"), null).setPositiveButton(WovenleafL10n.text("Go")) { _, _ ->
                input.text.toString().toIntOrNull()?.let { showPage((it - 1).coerceIn(0, pageCount - 1)) }
            }.show()
    }

    private fun showError(error: Exception? = null) {
        if (isDestroyed || isFinishing) return
        AlertDialog.Builder(this).setTitle(WovenleafL10n.text("This PDF couldn’t be opened"))
            .setMessage((error as? OriginalFileException)?.message ?: WovenleafL10n.text("Choose a readable, unprotected PDF. Your saved position and library are kept."))
            .setPositiveButton(WovenleafL10n.text("Library")) { _, _ -> finish() }.setOnCancelListener { finish() }.show()
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

internal fun renderPDFPage(page: PdfRenderer.Page, requestedWidth: Int, maxPixels: Int = 8_000_000): Bitmap {
    require(page.width > 0 && page.height > 0)
    // Bound allocation even for unusual page aspect ratios and large scans.
    val scale = min(requestedWidth.toDouble() / page.width, sqrt(maxPixels.toDouble() / (page.width.toDouble() * page.height)))
    val bitmap = Bitmap.createBitmap((page.width * scale).roundToInt().coerceAtLeast(1), (page.height * scale).roundToInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.WHITE)
    try { page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
    catch (error: Exception) { bitmap.recycle(); throw error }
    return bitmap
}

private class PDFPageView(
    context: Context,
    private val turn: (Int) -> Unit,
    private val fitChanged: (Boolean) -> Unit,
) : View(context) {
    private var bitmap: Bitmap? = null
    private val neighbors = mutableMapOf<Int, Bitmap>()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private var zoom = 1f
    private var panX = 0f
    private var panY = 0f
    private var swipeX = 0f
    private var releaseVelocity = 0f
    private var horizontalDrag = false
    private var hadMultiplePointers = false
    private var awaitingPage = false
    private var settle: ValueAnimator? = null
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val flingThreshold = 800 * resources.displayMetrics.density
    private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val old = zoom
            zoom = (zoom * detector.scaleFactor).coerceIn(1f, 5f)
            panX = (panX - (detector.focusX - width / 2f)) * (zoom / old) + detector.focusX - width / 2f
            panY = (panY - (detector.focusY - height / 2f)) * (zoom / old) + detector.focusY - height / 2f
            clampPan(); fitChanged(zoom <= 1.01f); invalidate(); return true
        }
    })
    private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true
        override fun onSingleTapUp(e: MotionEvent): Boolean { performClick(); return true }
        override fun onDoubleTap(e: MotionEvent): Boolean {
            cancelSwipe()
            zoom = if (zoom > 1f) 1f else 2.5f
            panX = (width / 2f - e.x) * (zoom - 1f); panY = (height / 2f - e.y) * (zoom - 1f)
            clampPan(); fitChanged(zoom <= 1.01f); invalidate(); return true
        }
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
            if (scale.isInProgress) return true
            if (zoom > 1.01f) {
                panX -= distanceX; panY -= distanceY; clampPan(); invalidate()
            } else if (!hadMultiplePointers && e1 != null) {
                val dx = e2.x - e1.x
                val dy = e2.y - e1.y
                if (!horizontalDrag && abs(dx) > touchSlop && abs(dx) > abs(dy) * 1.2f) horizontalDrag = true
                if (horizontalDrag) {
                    val direction = if (dx < 0) 1 else -1
                    // Resist a drag beyond the document boundary (or until a
                    // preview is ready), instead of exposing a blank next page.
                    swipeX = if (neighbors.containsKey(direction)) dx.coerceIn(-width.toFloat(), width.toFloat()) else dx * 0.12f
                    invalidate()
                }
            }
            return true
        }
        override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
            if (abs(velocityX) > abs(velocityY)) releaseVelocity = velocityX
            return true
        }
    })

    init { isFocusable = true; isClickable = true; setBackgroundColor(Color.rgb(238, 237, 231)) }
    fun show(value: Bitmap) {
        release(); bitmap = value; resetZoom()
    }
    fun preview(direction: Int, value: Bitmap) { neighbors.put(direction, value)?.recycle(); invalidate() }
    fun release() { cancelSwipe(); bitmap?.recycle(); bitmap = null; neighbors.values.forEach { it.recycle() }; neighbors.clear() }
    fun resetZoom() { cancelSwipe(); zoom = 1f; panX = 0f; panY = 0f; fitChanged(true); invalidate() }
    private fun cancelSwipe() {
        val animation = settle; settle = null; animation?.cancel()
        swipeX = 0f; awaitingPage = false; horizontalDrag = false
    }
    private fun finishSwipe(canceled: Boolean) {
        if (swipeX == 0f) return
        val direction = if (swipeX < 0) 1 else -1
        val forwardFling = abs(releaseVelocity) > flingThreshold && releaseVelocity * swipeX > 0
        val reverseFling = abs(releaseVelocity) > flingThreshold && releaseVelocity * swipeX < 0
        val commit = !canceled && !hadMultiplePointers && neighbors.containsKey(direction)
            && !reverseFling && (abs(swipeX) > width * 0.25f || forwardFling)
        awaitingPage = commit
        val target = if (commit) -direction * width.toFloat() else 0f
        val animation = ValueAnimator.ofFloat(swipeX, target)
        settle = animation
        animation.duration = 180
        animation.interpolator = DecelerateInterpolator()
        animation.addUpdateListener { swipeX = it.animatedValue as Float; invalidate() }
        animation.addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animator: Animator) {
                if (settle !== animator) return
                settle = null
                if (commit) turn(direction)
            }
        })
        animation.start()
    }
    private fun fit(value: Bitmap) = min(width.toFloat() / value.width, height.toFloat() / value.height)
    private fun clampPan() {
        val image = bitmap ?: return
        val x = ((image.width * fit(image) * zoom - width) / 2).coerceAtLeast(0f)
        val y = ((image.height * fit(image) * zoom - height) / 2).coerceAtLeast(0f)
        panX = panX.coerceIn(-x, x); panY = panY.coerceIn(-y, y)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { cancelSwipe(); clampPan() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val image = bitmap ?: return
        drawPage(canvas, image, swipeX, zoom, panX, panY)
        if (swipeX != 0f) {
            val direction = if (swipeX < 0) 1 else -1
            neighbors[direction]?.let { drawPage(canvas, it, swipeX + direction * width) }
        }
    }
    private fun drawPage(canvas: Canvas, image: Bitmap, offset: Float, scale: Float = 1f, x: Float = 0f, y: Float = 0f) {
        val factor = fit(image) * scale
        canvas.save()
        canvas.clipRect(offset, 0f, offset + width, height.toFloat())
        canvas.translate(offset + (width - image.width * factor) / 2 + x, (height - image.height * factor) / 2 + y)
        canvas.scale(factor, factor); canvas.drawBitmap(image, 0f, 0f, paint); canvas.restore()
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (awaitingPage) return true
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            cancelSwipe(); hadMultiplePointers = false; releaseVelocity = 0f
        }
        if (event.pointerCount > 1) { hadMultiplePointers = true; cancelSwipe() }
        scale.onTouchEvent(event); gestures.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            finishSwipe(event.actionMasked == MotionEvent.ACTION_CANCEL)
        }
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
}
