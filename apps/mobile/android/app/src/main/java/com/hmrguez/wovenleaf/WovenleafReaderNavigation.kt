package com.hmrguez.wovenleaf

import android.app.Dialog
import android.graphics.Typeface
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.getSystemService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.services.search.isSearchable
import org.readium.r2.shared.publication.services.search.search

internal data class ReaderBookmarkState(
    val id: String,
    val assetId: String,
    val assetFingerprint: String,
    val locator: Locator,
    val createdAt: String,
    var updatedAt: String,
)

internal data class ReaderNavigationState(
    val bookId: String,
    val editionId: String,
    var toc: TocState?,
    val bookmarks: MutableList<ReaderBookmarkState>,
    var updatedAt: String,
) {
    data class TocState(val assetFingerprint: String, val locator: Locator)

    companion object {
        fun fromJson(json: JSONObject?): ReaderNavigationState? {
            if (json?.optInt("version") != 1) return null
            val bookId = json.optString("bookId").takeIf(String::isNotBlank) ?: return null
            val editionId = json.optString("editionId").takeIf(String::isNotBlank) ?: return null
            val updatedAt = json.optString("updatedAt").takeIf(String::isNotBlank) ?: return null
            val bookmarkValues = json.optJSONArray("bookmarks") ?: return null
            val bookmarks = buildList {
                for (index in 0 until bookmarkValues.length()) {
                    val value = bookmarkValues.optJSONObject(index) ?: continue
                    val locator = Locator.fromJSON(value.optJSONObject("locator")) ?: continue
                    add(
                        ReaderBookmarkState(
                            id = value.optString("id"),
                            assetId = value.optString("assetId"),
                            assetFingerprint = value.optString("assetFingerprint"),
                            locator = locator,
                            createdAt = value.optString("createdAt"),
                            updatedAt = value.optString("updatedAt"),
                        )
                    )
                }
            }.toMutableList()
            val toc = json.optJSONObject("toc")?.let { value ->
                val fingerprint = value.optString("assetFingerprint").takeIf(String::isNotBlank)
                val locator = Locator.fromJSON(value.optJSONObject("locator"))
                if (fingerprint != null && locator != null) TocState(fingerprint, locator) else null
            }
            return ReaderNavigationState(bookId, editionId, toc, bookmarks, updatedAt)
        }
    }
}

internal class ReaderChapterRailView(
    context: android.content.Context,
    private val onNavigate: (Link) -> Unit,
) : View(context) {
    companion object {
        const val GUTTER_WIDTH_DP = 26
        const val RIGHT_PADDING_DP = 8
        const val CONTENT_INSET_DP = GUTTER_WIDTH_DP + RIGHT_PADDING_DP
        private const val MAX_VISIBLE_MARKERS = 7
    }

    private data class Entry(val link: Link, val depth: Int)

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private var entries: List<Entry> = emptyList()
    private var activeIndex = 0
    private var previewIndex: Int? = null
    private var pulseIndex: Int? = null
    private var palette = ReaderPalette("paper")
    private val railWidth = dp(GUTTER_WIDTH_DP).toFloat()
    private val markerSpacing = dp(10).toFloat()
    private val hidePreview = Runnable { previewIndex = null; invalidate() }
    private val hidePulse = Runnable { pulseIndex = null; invalidate() }

    init {
        isClickable = true
        isFocusable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = "Chapter rail"
        setBackgroundColor(Color.TRANSPARENT)
    }

    fun setLinks(links: List<Link>) {
        entries = flatten(links)
        activeIndex = activeIndex.coerceIn(0, maxOf(0, entries.lastIndex))
        refreshAccessibility()
        invalidate()
    }

    fun updateActive(locator: Locator?) {
        val href = locator?.href?.toString() ?: return
        val match = entries.indexOfLast {
            href.startsWith(it.link.url().toString()) || it.link.url().toString().startsWith(href)
        }
        if (match >= 0) {
            activeIndex = match
            refreshAccessibility()
            invalidate()
        }
    }

    fun applyPalette(value: ReaderPalette) {
        palette = value
        invalidate()
    }

    fun revealActiveMomentarily() {
        if (activeIndex !in entries.indices) return
        removeCallbacks(hidePulse)
        pulseIndex = activeIndex
        invalidate()
        postDelayed(hidePulse, 800)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (entries.isEmpty()) return
        val visible = visibleIndices()
        visible.forEach { index ->
            val y = markerY(index, visible)
            val active = index == activeIndex
            val emphasized = index == previewIndex || index == pulseIndex
            val width = dp(if (active) 18 else if (emphasized) 15 else 9).toFloat()
            markerPaint.strokeWidth = dp(if (active) 2 else 1).toFloat()
            markerPaint.color = withAlpha(
                if (active) palette.ink else palette.secondaryInk,
                if (active) 0.95f else if (emphasized) 0.65f else 0.32f,
            )
            canvas.drawLine(dp(4).toFloat(), y, dp(4).toFloat() + width, y, markerPaint)
        }
        previewIndex?.let { drawPreview(canvas, it) }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.x > railWidth && event.actionMasked == MotionEvent.ACTION_DOWN) return false
        val index = nearestIndex(event.y) ?: return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                removeCallbacks(hidePreview)
                previewIndex = index
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP -> {
                activeIndex = index
                previewIndex = index
                onNavigate(entries[index].link)
                performClick()
                reveal(index, 1_200)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                previewIndex = null
                invalidate()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onHoverEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_HOVER_EXIT) {
            previewIndex = null
            invalidate()
            return true
        }
        if (event.x <= railWidth) {
            previewIndex = nearestIndex(event.y)
            invalidate()
            return true
        }
        return false
    }

    override fun performClick(): Boolean {
        super.performClick()
        refreshAccessibility()
        return true
    }

    private fun drawPreview(canvas: Canvas, index: Int) {
        val cardLeft = dp(CONTENT_INSET_DP).toFloat()
        val cardWidth = minOf(dp(330).toFloat(), maxOf(dp(210).toFloat(), width.toFloat() - cardLeft - dp(14)))
        val anchorY = markerY(index, visibleIndices())
        val cardTop = (anchorY - dp(66)).coerceIn(dp(16).toFloat(), height - dp(148).toFloat())
        val card = RectF(cardLeft, cardTop, cardLeft + cardWidth, cardTop + dp(132))
        paint.style = Paint.Style.FILL
        paint.color = palette.raised
        canvas.drawRoundRect(card, dp(17).toFloat(), dp(17).toFloat(), paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1f
        paint.color = withAlpha(palette.rule, 0.72f)
        canvas.drawRoundRect(card, dp(17).toFloat(), dp(17).toFloat(), paint)

        var y = card.top + dp(27)
        listOf(index - 1, index, index + 1).filter(entries.indices::contains).forEach { entryIndex ->
            val focused = entryIndex == index
            paint.style = Paint.Style.FILL
            paint.color = if (focused) palette.ink else withAlpha(palette.secondaryInk, 0.72f)
            paint.textSize = sp(if (focused) 17f else 14f)
            paint.typeface = Typeface.create("serif", if (focused) Typeface.BOLD else Typeface.NORMAL)
            val raw = entries[entryIndex].link.title?.trim().orEmpty().ifBlank { "Untitled section" }
            val available = card.width() - dp(34 + minOf(entries[entryIndex].depth, 3) * 8)
            val title = android.text.TextUtils.ellipsize(raw, android.text.TextPaint(paint), available, android.text.TextUtils.TruncateAt.END).toString()
            canvas.drawText(title, card.left + dp(17 + minOf(entries[entryIndex].depth, 3) * 8), y, paint)
            y += dp(if (focused) 46 else 31)
        }
    }

    private fun reveal(index: Int, durationMs: Long) {
        if (index !in entries.indices) return
        removeCallbacks(hidePreview)
        pulseIndex = null
        previewIndex = index
        refreshAccessibility()
        invalidate()
        postDelayed(hidePreview, durationMs)
    }

    private fun nearestIndex(y: Float): Int? {
        val visible = visibleIndices()
        return visible.minByOrNull { index -> kotlin.math.abs(markerY(index, visible) - y) }
    }

    private fun visibleIndices(): List<Int> {
        if (entries.isEmpty()) return emptyList()
        val count = minOf(MAX_VISIBLE_MARKERS, entries.size)
        val focus = previewIndex ?: activeIndex
        val start = (focus - count / 2).coerceIn(0, entries.size - count)
        return (start until start + count).toList()
    }

    private fun markerY(index: Int, visible: List<Int>): Float {
        val offset = visible.indexOf(index)
        if (offset < 0 || visible.size == 1) return height / 2f
        val markerHeight = (visible.size - 1) * markerSpacing
        return (height - markerHeight) / 2f + offset * markerSpacing
    }

    private fun refreshAccessibility() {
        val title = entries.getOrNull(activeIndex)?.link?.title ?: "No chapters"
        contentDescription = "Chapter rail, $title"
    }

    private fun flatten(links: List<Link>, depth: Int = 0): List<Entry> = links.flatMap {
        listOf(Entry(it, depth)) + flatten(it.children, depth + 1)
    }

    private fun withAlpha(color: Int, alpha: Float): Int = Color.argb(
        (alpha.coerceIn(0f, 1f) * 255).toInt(),
        Color.red(color),
        Color.green(color),
        Color.blue(color),
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
}

@OptIn(ExperimentalReadiumApi::class)
internal class ReaderNavigationDialog(
    private val activity: AppCompatActivity,
    private val publication: Publication,
    private val state: ReaderNavigationState,
    private val palette: ReaderPalette,
    private val onNavigateLink: (Link) -> Unit,
    private val onNavigateLocator: (Locator) -> Unit,
    private val onDeleteBookmark: (ReaderBookmarkState) -> Unit,
    private val annotationState: ReaderAnnotationState,
    private val onEditAnnotation: (ReaderAnnotationRecord) -> Unit,
    private val onDeleteAnnotation: (ReaderAnnotationRecord) -> Unit,
    private val onReviewAnnotation: (ReaderAnnotationRecord) -> Unit,
) {
    private data class TocEntry(val link: Link, val depth: Int)

    private val tocEntries = flatten(publication.tableOfContents)
    private var mode = 0
    private var query = ""
    private var results: List<Locator> = emptyList()
    private var searchJob: Job? = null
    private lateinit var dialog: Dialog
    private lateinit var search: EditText
    private lateinit var list: LinearLayout
    private lateinit var contentsButton: Button
    private lateinit var bookmarksButton: Button
    private lateinit var notesButton: Button

    fun show(focusSearch: Boolean = false) {
        val shell = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(10))
            setBackgroundColor(palette.page)
        }
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(activity).apply {
            text = "Book map"
            textSize = 22f
            typeface = Typeface.create("serif", Typeface.NORMAL)
            setTextColor(palette.ink)
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(quietButton("Done") { dialog.dismiss() })
        shell.addView(header)

        val modes = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        contentsButton = modeButton("Contents") { mode = 0; query = ""; search.setText(""); refresh() }
        bookmarksButton = modeButton("Bookmarks") { mode = 1; query = ""; search.setText(""); refresh() }
        notesButton = modeButton("Notes") { mode = 2; query = ""; search.setText(""); refresh() }
        modes.addView(contentsButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        modes.addView(bookmarksButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        modes.addView(notesButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        shell.addView(modes)

        search = EditText(activity).apply {
            hint = if (publication.isSearchable) "Search in this book" else "Search unavailable for this book"
            contentDescription = "Search within book"
            isEnabled = publication.isSearchable
            isSingleLine = true
            setTextColor(palette.ink)
            setHintTextColor(palette.secondaryInk)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(palette.raised)
                setStroke(dp(1), palette.rule)
                cornerRadius = dp(12).toFloat()
            }
            setPadding(dp(14), 0, dp(14), 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(value: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(value: CharSequence?, start: Int, before: Int, count: Int) {
                    runSearch(value?.toString().orEmpty())
                }
                override fun afterTextChanged(value: Editable?) = Unit
            })
        }
        shell.addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)).apply {
            topMargin = dp(4)
            bottomMargin = dp(8)
        })

        list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        shell.addView(
            ScrollView(activity).apply { addView(list) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        refresh()
        dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(shell)
        dialog.setOnDismissListener { searchJob?.cancel() }
        dialog.setOnShowListener {
            dialog.window?.apply {
                setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
                setGravity(Gravity.BOTTOM)
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (activity.resources.displayMetrics.heightPixels * 0.9).toInt())
                navigationBarColor = palette.page
            }
            if (focusSearch) {
                search.requestFocus()
                search.post { activity.getSystemService<InputMethodManager>()?.showSoftInput(search, InputMethodManager.SHOW_IMPLICIT) }
            }
        }
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (activity.resources.displayMetrics.heightPixels * 0.9).toInt())
    }

    private fun modeButton(label: String, action: () -> Unit) = Button(activity).apply {
        text = label
        isAllCaps = false
        setTextColor(palette.ink)
        setOnClickListener { action() }
    }

    private fun quietButton(label: String, action: () -> Unit) = TextView(activity).apply {
        text = label
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(palette.ink)
        minWidth = dp(54)
        minHeight = dp(42)
        isClickable = true
        isFocusable = true
        setOnClickListener { action() }
    }

    private fun runSearch(raw: String) {
        searchJob?.cancel()
        query = raw.trim()
        if (query.isEmpty()) {
            results = emptyList()
            refresh()
            return
        }
        status("Searching…")
        searchJob = activity.lifecycleScope.launch {
            delay(250)
            val iterator = publication.search(query)
            if (iterator == null) {
                status("Search is unavailable for this publication.")
                return@launch
            }
            val found = mutableListOf<Locator>()
            while (found.size < 250) {
                val page = iterator.next().getOrNull() ?: break
                found += page.locators.take(250 - found.size)
            }
            iterator.close()
            results = found
            refresh()
        }
    }

    private fun refresh() {
        if (!::list.isInitialized) return
        list.removeAllViews()
        listOf(contentsButton, bookmarksButton, notesButton).forEachIndexed { index, button ->
            val selected = index == mode
            button.setTextColor(if (selected) palette.inverseInk else palette.ink)
            button.background = android.graphics.drawable.GradientDrawable().apply {
                setColor(if (selected) palette.ink else Color.TRANSPARENT)
                setStroke(dp(1), palette.rule)
                cornerRadius = dp(10).toFloat()
            }
        }
        if (query.isNotEmpty()) {
            if (results.isEmpty()) status("No passages found.") else results.forEach(::addSearchResult)
        } else if (mode == 0) {
            if (tocEntries.isEmpty()) status("This publication does not include a table of contents.")
            else tocEntries.forEach(::addTocEntry)
        } else if (mode == 1) {
            val bookmarks = state.bookmarks.sortedByDescending { it.updatedAt }
            if (bookmarks.isEmpty()) status("No bookmarks yet.") else bookmarks.forEach(::addBookmark)
        } else {
            val annotations = annotationState.annotations
                .filterNot(ReaderAnnotationRecord::isDeleted)
                .sortedWith(compareByDescending<ReaderAnnotationRecord> { it.updatedAt }.thenBy { it.id })
            if (annotations.isEmpty()) status("No highlights or notes yet.") else annotations.forEach(::addAnnotation)
        }
    }

    private fun status(message: String) {
        if (!::list.isInitialized) return
        list.removeAllViews()
        list.addView(TextView(activity).apply {
            text = message
            gravity = Gravity.CENTER
            textSize = 15f
            setTextColor(palette.secondaryInk)
            setPadding(dp(18), dp(42), dp(18), dp(42))
        })
    }

    private fun addTocEntry(entry: TocEntry) {
        val selected = state.toc?.locator?.href == publication.locatorFromLink(entry.link)?.href
        addRow(
            title = (if (selected) "• " else "") + (entry.link.title ?: "Untitled section"),
            detail = "Level ${entry.depth + 1}",
            inset = entry.depth * 18,
        ) {
            onNavigateLink(entry.link)
            dialog.dismiss()
        }
    }

    private fun addSearchResult(locator: Locator) {
        val excerpt = listOfNotNull(locator.text.before, locator.text.highlight, locator.text.after)
            .joinToString(" ").replace(Regex("\\s+"), " ").trim().take(190)
        addRow(locator.title ?: "Passage", excerpt.ifBlank { "Open match" }) {
            onNavigateLocator(locator)
            dialog.dismiss()
        }
    }

    private fun addBookmark(bookmark: ReaderBookmarkState) {
        val progression = bookmark.locator.locations.totalProgression?.let { "${(it * 100).toInt()}%" }
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(palette.page)
        }
        row.addView(
            rowText(bookmark.locator.title ?: "Saved passage", progression ?: "Bookmark").apply {
                setOnClickListener {
                    onNavigateLocator(bookmark.locator)
                    dialog.dismiss()
                }
            },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        row.addView(Button(activity).apply {
            text = "Remove"
            isAllCaps = false
            contentDescription = "Remove bookmark"
            setTextColor(palette.secondaryInk)
            setBackgroundColor(palette.page)
            setOnClickListener {
                onDeleteBookmark(bookmark)
                state.bookmarks.removeAll { it.id == bookmark.id }
                refresh()
            }
        })
        list.addView(row)
        addRule()
    }

    private fun addAnnotation(annotation: ReaderAnnotationRecord) {
        val detail = buildList {
            add(annotation.quote.replace(Regex("\\s+"), " ").trim().take(160))
            annotation.chapter?.let(::add)
            if (annotation.anchorStatus == "review") add("Needs review")
            if (annotation.note.isNotBlank()) add(annotation.note.replace(Regex("\\s+"), " ").trim().take(120))
            if (annotation.tags.isNotEmpty()) add(annotation.tags.joinToString(" · "))
        }.joinToString("\n")
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(palette.page)
        }
        row.addView(rowText(
            if (annotation.anchorStatus == "review") "Needs review" else annotation.chapter ?: "Highlighted passage",
            detail,
        ).apply {
            setPadding(dp(14), dp(11), dp(14), dp(6))
            setOnClickListener {
                dialog.dismiss()
                if (annotation.anchorStatus == "review") onReviewAnnotation(annotation)
                else onNavigateLocator(annotation.locator)
            }
        })
        row.addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            addView(modeButton(if (annotation.anchorStatus == "review") "Review" else "Edit") {
                dialog.dismiss()
                if (annotation.anchorStatus == "review") onReviewAnnotation(annotation)
                else onEditAnnotation(annotation)
            })
            addView(modeButton("Delete") {
                onDeleteAnnotation(annotation)
                refresh()
            })
        })
        list.addView(row)
        addRule()
    }

    private fun addRow(title: String, detail: String, inset: Int = 0, action: () -> Unit) {
        list.addView(rowText(title, detail).apply {
            setPadding(dp(14 + inset), dp(11), dp(14), dp(11))
            setOnClickListener { action() }
        })
        addRule()
    }

    private fun rowText(title: String, detail: String) = TextView(activity).apply {
        text = if (detail.isBlank()) title else "$title\n$detail"
        textSize = 15f
        setTextColor(palette.ink)
        typeface = Typeface.create("serif", Typeface.NORMAL)
        minHeight = dp(54)
        gravity = Gravity.CENTER_VERTICAL
        contentDescription = if (detail.isBlank()) title else "$title. $detail"
    }

    private fun addRule() {
        list.addView(View(activity).apply { setBackgroundColor(palette.rule) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
    }

    private fun flatten(links: List<Link>, depth: Int = 0): List<TocEntry> = links.flatMap { link ->
        listOf(TocEntry(link, depth)) + flatten(link.children, depth + 1)
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()
}
