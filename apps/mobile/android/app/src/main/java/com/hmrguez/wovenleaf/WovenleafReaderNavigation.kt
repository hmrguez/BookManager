package com.hmrguez.wovenleaf

import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
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

@OptIn(ExperimentalReadiumApi::class)
internal class ReaderNavigationDialog(
    private val activity: AppCompatActivity,
    private val publication: Publication,
    private val state: ReaderNavigationState,
    private val palette: ReaderPalette,
    private val onNavigateLink: (Link) -> Unit,
    private val onNavigateLocator: (Locator) -> Unit,
    private val onDeleteBookmark: (ReaderBookmarkState) -> Unit,
) {
    private data class TocEntry(val link: Link, val depth: Int)

    private val tocEntries = flatten(publication.tableOfContents)
    private var mode = 0
    private var query = ""
    private var results: List<Locator> = emptyList()
    private var searchJob: Job? = null
    private lateinit var dialog: AlertDialog
    private lateinit var search: EditText
    private lateinit var list: LinearLayout
    private lateinit var contentsButton: Button
    private lateinit var bookmarksButton: Button

    fun show(focusSearch: Boolean = false) {
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(12), dp(8))
            setBackgroundColor(palette.page)
        }
        val modes = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        contentsButton = modeButton("Contents") { mode = 0; query = ""; search.setText(""); refresh() }
        bookmarksButton = modeButton("Bookmarks") { mode = 1; query = ""; search.setText(""); refresh() }
        modes.addView(contentsButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        modes.addView(bookmarksButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        root.addView(modes)

        search = EditText(activity).apply {
            hint = if (publication.isSearchable) "Search in this book" else "Search unavailable for this book"
            contentDescription = "Search within book"
            isEnabled = publication.isSearchable
            isSingleLine = true
            setTextColor(palette.ink)
            setHintTextColor(palette.secondaryInk)
            setBackgroundColor(palette.raised)
            setPadding(dp(14), 0, dp(14), 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(value: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(value: CharSequence?, start: Int, before: Int, count: Int) {
                    runSearch(value?.toString().orEmpty())
                }
                override fun afterTextChanged(value: Editable?) = Unit
            })
        }
        root.addView(search, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        root.addView(
            ScrollView(activity).apply { addView(list) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )
        refresh()
        dialog = AlertDialog.Builder(activity)
            .setTitle("Navigate")
            .setView(root)
            .setNegativeButton("Done", null)
            .create()
        dialog.setOnDismissListener { searchJob?.cancel() }
        dialog.setOnShowListener {
            dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (activity.resources.displayMetrics.heightPixels * 0.88).toInt())
            if (focusSearch) {
                search.requestFocus()
                search.post { activity.getSystemService<InputMethodManager>()?.showSoftInput(search, InputMethodManager.SHOW_IMPLICIT) }
            }
        }
        dialog.show()
    }

    private fun modeButton(label: String, action: () -> Unit) = Button(activity).apply {
        text = label
        isAllCaps = false
        setBackgroundColor(palette.page)
        setTextColor(palette.ink)
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
        contentsButton.isEnabled = mode != 0
        bookmarksButton.isEnabled = mode != 1
        if (query.isNotEmpty()) {
            if (results.isEmpty()) status("No passages found.") else results.forEach(::addSearchResult)
        } else if (mode == 0) {
            if (tocEntries.isEmpty()) status("This publication does not include a table of contents.")
            else tocEntries.forEach(::addTocEntry)
        } else {
            val bookmarks = state.bookmarks.sortedByDescending { it.updatedAt }
            if (bookmarks.isEmpty()) status("No bookmarks yet.") else bookmarks.forEach(::addBookmark)
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
