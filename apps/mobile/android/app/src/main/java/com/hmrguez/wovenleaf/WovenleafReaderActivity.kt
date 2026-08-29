package com.hmrguez.wovenleaf

import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Color
import android.graphics.Typeface
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.text.Html
import android.text.TextUtils
import android.util.Base64
import android.view.Gravity
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.readium.r2.navigator.HyperlinkNavigator
import org.readium.r2.navigator.DecorableNavigator
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.Selection
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.services.locateProgression
import org.readium.r2.shared.publication.services.isRestricted
import org.readium.r2.shared.publication.services.search.search
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.shared.util.toUri
import org.readium.r2.shared.util.toUrl
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser
import java.io.File
import java.util.Locale
import java.util.UUID

@OptIn(ExperimentalReadiumApi::class)
class WovenleafReaderActivity : AppCompatActivity(), EpubNavigatorFragment.Listener,
    EpubNavigatorFragment.PaginationListener {
    private lateinit var readerContext: ReaderContext
    private lateinit var chrome: LinearLayout
    private lateinit var topChrome: LinearLayout
    private lateinit var bottomChrome: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var progress: TextView
    private lateinit var titleView: TextView
    private lateinit var appearanceButton: Button
    private lateinit var bookmarkButton: Button
    private lateinit var historyButton: Button
    private lateinit var scrubber: SeekBar
    private lateinit var loading: ProgressBar
    private lateinit var texture: PaperTextureView
    private var publication: Publication? = null
    private var navigator: EpubNavigatorFragment? = null
    private var lastLocator: Locator? = null
    private var locationJob: Job? = null
    private var checkpointJob: Job? = null
    private var preferenceJob: Job? = null
    private var pendingPreference: Pair<ReaderPreferenceScope, WovenleafReaderPreferences?>? = null
    private val navigationHistory = ArrayDeque<Locator>()
    private var pendingJumpOrigin: Locator? = null
    private var restoringHistory = false
    private var scrubbing = false
    private val sessionId = "reading-session:reader:${UUID.randomUUID().toString().lowercase()}"
    private val sessionStartedAt = ReaderOutbox.timestamp()
    private val sessionStartedUptime = SystemClock.elapsedRealtime()
    private var sessionClosed = false
    private var textToSpeech: TextToSpeech? = null
    private var speechReady = false
    private var presentedCompatibilityNotice = false
    private val annotationDecorationListener = object : DecorableNavigator.Listener {
        override fun onDecorationActivated(event: DecorableNavigator.OnActivatedEvent): Boolean {
            val annotation = readerContext.annotationState.annotations.firstOrNull {
                it.id == event.decoration.id && !it.isDeleted
            } ?: return false
            editAnnotation(annotation)
            return true
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        supportFragmentManager.fragmentFactory = EpubNavigatorFragment.createDummyFactory()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        readerContext = readContext() ?: run {
            finish()
            return
        }
        textToSpeech = TextToSpeech(this) { status ->
            speechReady = status == TextToSpeech.SUCCESS
            if (speechReady) {
                textToSpeech?.language = Locale.forLanguageTag(
                    readerContext.compatibility?.primaryLanguage ?: Locale.getDefault().toLanguageTag(),
                )
            }
        }
        buildReaderChrome()
        openPublication()
    }

    override fun onPause() {
        flushPreference()
        flushLocation()
        super.onPause()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        navigator?.submitPreferences(readerPreferences())
        applyChromePalette()
    }

    override fun onDestroy() {
        checkpointJob?.cancel()
        preferenceJob?.cancel()
        locationJob?.cancel()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        if (isFinishing) publication?.close()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!goBackInBook()) closeReader()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        when {
            event.keyCode == KeyEvent.KEYCODE_ESCAPE -> {
                if (!goBackInBook()) closeReader()
                return true
            }
            event.isCtrlPressed && event.keyCode == KeyEvent.KEYCODE_F -> {
                showNavigation(focusSearch = true)
                return true
            }
            event.isCtrlPressed && event.keyCode == KeyEvent.KEYCODE_B -> {
                toggleBookmark()
                return true
            }
            event.isCtrlPressed && event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_H -> {
                createAnnotationFromSelection()
                return true
            }
            event.isCtrlPressed && event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_N -> {
                createAnnotationFromSelection()
                return true
            }
            event.isCtrlPressed && event.isShiftPressed && event.keyCode == KeyEvent.KEYCODE_S -> {
                readSelectionAloud()
                return true
            }
            event.isAltPressed && event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> {
                goBackInBook()
                return true
            }
            event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> {
                if (readerContext.compatibility?.isRightToLeft == true) {
                    navigator?.goForward(animated = true)
                } else {
                    navigator?.goBackward(animated = true)
                }
                return true
            }
            event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (readerContext.compatibility?.isRightToLeft == true) {
                    navigator?.goBackward(animated = true)
                } else {
                    navigator?.goForward(animated = true)
                }
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun openPublication() {
        lifecycleScope.launch {
            val file = File(requireNotNull(intent.getStringExtra(ReaderContract.FILE_PATH)))
            if (!file.isFile) {
                showRecovery("The managed EPUB file is missing.")
                return@launch
            }
            val httpClient = DefaultHttpClient()
            val assetRetriever = AssetRetriever(contentResolver, httpClient)
            val parser = DefaultPublicationParser(this@WovenleafReaderActivity, httpClient, assetRetriever, null)
            val opener = PublicationOpener(parser)
            val asset = assetRetriever.retrieve(file.toUrl(isDirectory = false)).getOrElse {
                showRecovery("This EPUB could not be read safely.")
                return@launch
            }
            val opened = opener.open(asset, allowUserInteraction = false).getOrElse {
                showRecovery("This EPUB could not be opened safely.")
                return@launch
            }
            if (opened.isRestricted || !opened.conformsTo(Publication.Profile.EPUB)) {
                opened.close()
                showRecovery("This file is not an unprotected EPUB.")
                return@launch
            }
            publication = opened
            showNavigator(opened)
        }
    }

    private fun showNavigator(opened: Publication) {
        val initialLocator = ReaderOutbox.latestLocator(this, readerContext.assetId)
            ?.let { Locator.fromJSON(it) }
            ?: intent.getStringExtra(ReaderContract.INITIAL_LOCATOR)
            ?.let { runCatching { Locator.fromJSON(JSONObject(it)) }.getOrNull() }
        val factory = EpubNavigatorFactory(opened)
        val configuration = EpubNavigatorFragment.Configuration().apply {
            registerJavascriptInterface("WovenleafImages") { resource -> ReaderImageBridge(resource) }
            selectionActionModeCallback = ReaderSelectionActionModeCallback()
        }
        supportFragmentManager.fragmentFactory = factory.createFragmentFactory(
            initialLocator = initialLocator,
            initialPreferences = readerPreferences(),
            listener = this,
            paginationListener = this,
            configuration = configuration,
        )
        supportFragmentManager.fragments.forEach {
            supportFragmentManager.beginTransaction().remove(it).commitNow()
        }
        val fragment = supportFragmentManager.fragmentFactory.instantiate(
            classLoader,
            EpubNavigatorFragment::class.java.name,
        ) as EpubNavigatorFragment
        supportFragmentManager.beginTransaction().replace(content.id, fragment, "epub-navigator").commitNow()
        navigator = fragment
        fragment.addDecorationListener(ANNOTATION_GROUP, annotationDecorationListener)
        applyAnnotationDecorations()
        attemptAnnotationReanchoring()
        loading.visibility = View.GONE
        texture.bringToFront()
        if (!presentedCompatibilityNotice && readerContext.compatibility?.notices?.isNotEmpty() == true) {
            presentedCompatibilityNotice = true
            showCompatibilityNotice()
        } else {
            content.sendAccessibilityEvent(android.view.accessibility.AccessibilityEvent.TYPE_VIEW_FOCUSED)
        }

        ReaderOutbox.enqueue(
            this,
            "start",
            readerContext,
            sessionId,
            initialLocator?.toJSON(),
        )
        locationJob = lifecycleScope.launch {
            fragment.currentLocator.collectLatest { locator ->
                lastLocator = locator
                updateProgress(locator)
                updateBookmarkButton()
                checkpointJob?.cancel()
                checkpointJob = launch {
                    delay(750)
                    flushLocation()
                }
            }
        }
    }

    private fun readerPreferences() = (
        readerContext.compatibility?.renderingPreferences(effectivePreferences()) ?: effectivePreferences()
    ).toReadium(
        compactWidth = resources.configuration.screenWidthDp < 700,
        highContrast = isHighContrast(this),
    )

    private fun buildReaderChrome() {
        chrome = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        topChrome = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        topChrome.addView(textButton("Library") { closeReader() })
        titleView = TextView(this).apply {
            text = readerContext.title
            textSize = 16f
            typeface = Typeface.create("serif", Typeface.NORMAL)
            maxLines = 1
            gravity = Gravity.CENTER
        }
        topChrome.addView(titleView, LinearLayout.LayoutParams(0, dp(48), 1f))
        bookmarkButton = textButton("Bookmark") { toggleBookmark() }.apply {
            contentDescription = "Add bookmark"
        }
        topChrome.addView(bookmarkButton)
        if (readerContext.compatibility?.notices?.isNotEmpty() == true) {
            topChrome.addView(textButton("Info") { showCompatibilityNotice() }.apply {
                contentDescription = "Reading compatibility"
            })
        }
        appearanceButton = textButton("Aa") { showReaderSettings() }
        appearanceButton.contentDescription = "Reading appearance"
        appearanceButton.typeface = Typeface.create("serif", Typeface.BOLD)
        appearanceButton.textSize = 17f
        topChrome.addView(appearanceButton)
        chrome.addView(topChrome, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)))

        content = FrameLayout(this).apply { id = View.generateViewId() }
        loading = ProgressBar(this)
        content.addView(loading, FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
        texture = PaperTextureView(this)
        content.addView(texture, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))
        loading.bringToFront()
        chrome.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        bottomChrome = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(8))
        }
        bottomChrome.addView(textButton("Contents") { showNavigation() }.apply {
            contentDescription = "Contents, bookmarks, and search"
        })
        historyButton = textButton("Back") { goBackInBook() }.apply {
            contentDescription = "Return to previous passage"
            isEnabled = false
        }
        bottomChrome.addView(historyButton)
        val progressGroup = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        progress = TextView(this).apply {
            text = "Opening…"
            textSize = 12f
            typeface = Typeface.MONOSPACE
            gravity = Gravity.CENTER
        }
        progressGroup.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(28)))
        scrubber = SeekBar(this).apply {
            max = 1000
            contentDescription = "Reading position"
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(view: SeekBar?, value: Int, fromUser: Boolean) {
                    if (fromUser) this@WovenleafReaderActivity.progress.text = "${(value / 10.0).toInt()}%"
                }
                override fun onStartTrackingTouch(view: SeekBar?) { scrubbing = true }
                override fun onStopTrackingTouch(view: SeekBar?) {
                    scrubbing = false
                    scrubTo((view?.progress ?: 0) / 1000.0)
                }
            })
        }
        progressGroup.addView(scrubber, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
        bottomChrome.addView(progressGroup, LinearLayout.LayoutParams(0, dp(64), 1f))
        bottomChrome.addView(textButton(if (readerContext.compatibility?.isRightToLeft == true) "›" else "‹") {
            navigator?.goBackward(animated = true)
        }.apply {
            textSize = 24f
            contentDescription = "Previous page"
        })
        bottomChrome.addView(textButton(if (readerContext.compatibility?.isRightToLeft == true) "‹" else "›") {
            navigator?.goForward(animated = true)
        }.apply {
            textSize = 24f
            contentDescription = "Next page"
        })
        chrome.addView(bottomChrome, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(76)))
        topChrome.accessibilityTraversalBefore = content.id
        content.accessibilityTraversalAfter = topChrome.id
        content.accessibilityTraversalBefore = bottomChrome.id
        bottomChrome.accessibilityTraversalAfter = content.id
        setContentView(chrome)
        applyChromePalette()
    }

    private fun textButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { action() }
    }

    private fun showReaderSettings() {
        ReaderSettingsDialog(
            activity = this,
            globalPreferences = readerContext.globalPreferences,
            bookPreferences = readerContext.bookPreferences,
            compactWidth = resources.configuration.screenWidthDp < 700,
        ) { scope, preferences -> savePreferences(scope, preferences) }.show()
    }

    private fun showNavigation(focusSearch: Boolean = false) {
        val opened = publication ?: return
        ReaderNavigationDialog(
            activity = this,
            publication = opened,
            state = readerContext.navigationState,
            palette = ReaderPalette(effectivePreferences().theme, isHighContrast(this)),
            onNavigateLink = { link -> navigate(link, fromToc = true) },
            onNavigateLocator = { locator -> navigate(locator) },
            onDeleteBookmark = { bookmark -> deleteBookmark(bookmark) },
            annotationState = readerContext.annotationState,
            onEditAnnotation = { annotation -> editAnnotation(annotation) },
            onDeleteAnnotation = { annotation -> deleteAnnotation(annotation) },
            onReviewAnnotation = { annotation -> reviewAnnotation(annotation) },
        ).show(focusSearch)
    }

    private fun navigate(link: Link, fromToc: Boolean = false) {
        val fragment = navigator ?: return
        pendingJumpOrigin = lastLocator ?: fragment.currentLocator.value
        if (!fragment.go(link, animated = true)) {
            pendingJumpOrigin = null
            readerMessage("Section unavailable", "This book’s navigation entry is broken or missing.")
            return
        }
        if (fromToc) {
            publication?.locatorFromLink(link)?.let { locator ->
                readerContext.navigationState.toc = ReaderNavigationState.TocState(
                    readerContext.assetFingerprint,
                    locator,
                )
                readerContext.navigationState.updatedAt = ReaderOutbox.timestamp()
                ReaderOutbox.enqueueToc(this, readerContext, sessionId, locator)
            }
        }
    }

    private fun navigate(locator: Locator) {
        val fragment = navigator ?: return
        pendingJumpOrigin = lastLocator ?: fragment.currentLocator.value
        if (!fragment.go(locator, animated = true)) {
            pendingJumpOrigin = null
            readerMessage("Passage unavailable", "Wovenleaf could not recover this passage in the current edition.")
        }
    }

    private fun scrubTo(progression: Double) {
        lifecycleScope.launch {
            val locator = publication?.locateProgression(progression)
            if (locator == null) {
                readerMessage("Position unavailable", "This book does not provide enough navigation data for precise scrubbing.")
            } else {
                navigate(locator)
            }
        }
    }

    private fun goBackInBook(): Boolean {
        val locator = navigationHistory.removeLastOrNull() ?: return false
        restoringHistory = true
        updateHistoryButton()
        if (navigator?.go(locator, animated = true) != true) {
            restoringHistory = false
            navigationHistory.addLast(locator)
            updateHistoryButton()
            readerMessage("Passage unavailable", "The previous passage is no longer available.")
        }
        return true
    }

    private fun toggleBookmark() {
        val locator = lastLocator ?: navigator?.currentLocator?.value ?: return
        val existing = readerContext.navigationState.bookmarks.firstOrNull { samePassage(it.locator, locator) }
        if (existing != null) {
            deleteBookmark(existing)
            return
        }
        val timestamp = ReaderOutbox.timestamp()
        val bookmark = ReaderBookmarkState(
            id = "reader-bookmark:${UUID.randomUUID().toString().lowercase()}",
            assetId = readerContext.assetId,
            assetFingerprint = readerContext.assetFingerprint,
            locator = locator,
            createdAt = timestamp,
            updatedAt = timestamp,
        )
        readerContext.navigationState.bookmarks.add(bookmark)
        readerContext.navigationState.updatedAt = timestamp
        ReaderOutbox.enqueueBookmark(
            this,
            readerContext,
            sessionId,
            "upsert",
            bookmark.id,
            locator,
            timestamp,
        )
        updateBookmarkButton()
        bookmarkButton.announceForAccessibility("Bookmark added")
    }

    private fun deleteBookmark(bookmark: ReaderBookmarkState) {
        readerContext.navigationState.bookmarks.removeAll { it.id == bookmark.id }
        readerContext.navigationState.updatedAt = ReaderOutbox.timestamp()
        ReaderOutbox.enqueueBookmark(this, readerContext, sessionId, "delete", bookmark.id)
        updateBookmarkButton()
        bookmarkButton.announceForAccessibility("Bookmark removed")
    }

    private inner class ReaderSelectionActionModeCallback : ActionMode.Callback {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            menu.add(Menu.NONE, SELECTION_COPY, 0, "Copy")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
            menu.add(Menu.NONE, SELECTION_HIGHLIGHT, 1, "Highlight")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
            menu.add(Menu.NONE, SELECTION_NOTE, 2, "Add note")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
            menu.add(Menu.NONE, SELECTION_READ_ALOUD, 3, "Read aloud")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
            return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = false

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
            if (item.itemId !in setOf(
                    SELECTION_COPY,
                    SELECTION_HIGHLIGHT,
                    SELECTION_NOTE,
                    SELECTION_READ_ALOUD,
                )
            ) return false
            val fragment = navigator ?: return false
            lifecycleScope.launch {
                val selection = fragment.currentSelection()
                when (item.itemId) {
                    SELECTION_COPY -> copySelection(selection)
                    SELECTION_READ_ALOUD -> readSelection(selection)
                    else -> presentNewAnnotation(selection)
                }
                fragment.clearSelection()
                mode.finish()
            }
            return true
        }

        override fun onDestroyActionMode(mode: ActionMode) = Unit
    }

    private fun copySelection(selection: Selection?) {
        val quote = selection?.locator?.text?.highlight?.trim().orEmpty()
        if (quote.isEmpty()) return
        val clipboard = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Book passage", quote))
        content.announceForAccessibility("Passage copied")
    }

    private fun readSelectionAloud() {
        val fragment = navigator ?: return
        lifecycleScope.launch {
            readSelection(fragment.currentSelection())
            fragment.clearSelection()
        }
    }

    private fun readSelection(selection: Selection?) {
        val quote = selection?.locator?.text?.highlight?.trim().orEmpty()
        if (quote.isEmpty()) {
            readerMessage("Select a passage", "Select a passage first, then choose Read aloud.")
            return
        }
        if (!speechReady) {
            readerMessage("Read aloud unavailable", "The system speech service is not ready. Try again in a moment.")
            return
        }
        textToSpeech?.speak(quote, TextToSpeech.QUEUE_FLUSH, null, "wovenleaf-selection")
        content.announceForAccessibility("Reading selected passage aloud")
    }

    private fun createAnnotationFromSelection() {
        val fragment = navigator ?: return
        lifecycleScope.launch {
            presentNewAnnotation(fragment.currentSelection())
            fragment.clearSelection()
        }
    }

    private fun presentNewAnnotation(selection: Selection?) {
        val locator = selection?.locator
        val quote = locator?.text?.highlight?.trim().orEmpty()
        if (locator == null || quote.isEmpty() || quote.length > 10_000) {
            readerMessage(
                if (selection == null) "Select a passage" else "Selection unavailable",
                "Choose a passage between 1 and 10,000 characters. Wovenleaf does not save whole chapters as annotations.",
            )
            return
        }
        presentAnnotationEditor(locator, annotation = null)
    }

    private fun editAnnotation(annotation: ReaderAnnotationRecord) {
        presentAnnotationEditor(annotation.locator, annotation)
    }

    private fun reviewAnnotation(annotation: ReaderAnnotationRecord) {
        val opened = publication ?: return
        lifecycleScope.launch {
            val candidates = matchingReanchorCandidates(opened, annotation)
            if (candidates.isEmpty()) {
                readerMessage(
                    "Passage unavailable",
                    "This revised EPUB no longer contains the quoted passage. The annotation remains in Needs Review.",
                )
            } else if (candidates.size == 1) {
                openReviewCandidate(candidates.first(), annotation)
            } else {
                val choices = candidates.take(12)
                AlertDialog.Builder(this@WovenleafReaderActivity)
                    .setTitle("Choose the matching passage")
                    .setMessage("The quote appears more than once. Compare its chapter and surrounding words before confirming.")
                    .setItems(choices.map(::reviewCandidateLabel).toTypedArray()) { _, index ->
                        openReviewCandidate(choices[index], annotation)
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    private fun openReviewCandidate(locator: Locator, annotation: ReaderAnnotationRecord) {
        val fragment = navigator ?: return
        if (!fragment.go(locator, animated = true)) {
            readerMessage("Passage unavailable", "This matching range could not be opened.")
            return
        }
        presentAnnotationEditor(locator, annotation, needsReview = true)
    }

    private fun reviewCandidateLabel(locator: Locator): String {
        val context = listOfNotNull(locator.text.before, locator.text.highlight, locator.text.after)
            .joinToString(" ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(90)
        return "${locator.title ?: "Passage"} — $context"
    }

    private fun presentAnnotationEditor(
        locator: Locator,
        annotation: ReaderAnnotationRecord?,
        needsReview: Boolean = false,
    ) {
        val palette = ReaderPalette(effectivePreferences().theme, isHighContrast(this))
        val quote = annotation?.quote ?: locator.text.highlight?.trim().orEmpty()
        ReaderAnnotationEditorDialog(
            activity = this,
            palette = palette,
            quote = quote,
            annotation = annotation,
            needsReview = needsReview,
            onSave = { color, note, tags ->
                saveAnnotation(annotation, locator, color, note, tags, confirmingRevision = needsReview)
            },
            onDelete = annotation?.let { current -> { deleteAnnotation(current) } },
        ).show()
    }

    private fun saveAnnotation(
        existing: ReaderAnnotationRecord?,
        locator: Locator,
        color: ReaderAnnotationColor,
        note: String,
        tags: List<String>,
        confirmingRevision: Boolean,
    ) {
        val timestamp = ReaderOutbox.timestamp()
        val annotation = if (existing == null) {
            ReaderAnnotationRecord(
                id = "reader-annotation:${UUID.randomUUID().toString().lowercase()}",
                bookId = readerContext.bookId,
                editionId = readerContext.editionId,
                assetId = readerContext.assetId,
                assetFingerprint = readerContext.assetFingerprint,
                locator = locator,
                quote = locator.text.highlight?.trim().orEmpty(),
                prefix = locator.text.before.orEmpty().takeLast(1_000),
                suffix = locator.text.after.orEmpty().take(1_000),
                chapter = locator.title?.take(500),
                color = color,
                note = note,
                tags = tags,
                createdAt = timestamp,
                updatedAt = timestamp,
                deletedAt = null,
                anchorStatus = "exact",
                previousAssetFingerprint = null,
                anchorReason = null,
                platform = "android",
                toolkitVersion = "3.3.0",
            )
        } else {
            existing.apply {
                this.color = color
                this.note = note
                this.tags = tags
                updatedAt = timestamp
                deletedAt = null
                if (confirmingRevision) {
                    this.locator = locator
                    editionId = readerContext.editionId
                    assetId = readerContext.assetId
                    assetFingerprint = readerContext.assetFingerprint
                    anchorStatus = "reanchored"
                    anchorReason = null
                }
            }
        }
        readerContext.annotationState.annotations.removeAll { it.id == annotation.id }
        readerContext.annotationState.annotations.add(annotation)
        readerContext.annotationState.annotations.sortWith(compareBy({ it.createdAt }, { it.id }))
        readerContext.annotationState.updatedAt = timestamp
        ReaderOutbox.enqueueAnnotation(
            this,
            readerContext,
            sessionId,
            "upsert",
            annotation.id,
            annotation,
        )
        navigator?.clearSelection()
        applyAnnotationDecorations()
        content.announceForAccessibility(if (existing == null) "Highlight saved" else "Annotation updated")
    }

    private fun deleteAnnotation(annotation: ReaderAnnotationRecord) {
        val stored = readerContext.annotationState.annotations.firstOrNull { it.id == annotation.id } ?: return
        val timestamp = ReaderOutbox.timestamp()
        stored.deletedAt = timestamp
        stored.updatedAt = timestamp
        readerContext.annotationState.updatedAt = timestamp
        ReaderOutbox.enqueueAnnotation(this, readerContext, sessionId, "delete", stored.id)
        applyAnnotationDecorations()
        AlertDialog.Builder(this)
            .setTitle("Annotation deleted")
            .setMessage("The deletion is retained for sync and portable export. You can undo it now.")
            .setNegativeButton("Done", null)
            .setPositiveButton("Undo") { _, _ -> restoreAnnotation(stored.id) }
            .show()
    }

    private fun restoreAnnotation(id: String) {
        val annotation = readerContext.annotationState.annotations.firstOrNull { it.id == id } ?: return
        annotation.deletedAt = null
        annotation.updatedAt = ReaderOutbox.timestamp()
        readerContext.annotationState.updatedAt = annotation.updatedAt
        ReaderOutbox.enqueueAnnotation(this, readerContext, sessionId, "restore", id)
        applyAnnotationDecorations()
        content.announceForAccessibility("Annotation restored")
    }

    private fun applyAnnotationDecorations() {
        val fragment = navigator ?: return
        val decorations = readerContext.annotationState.annotations.mapNotNull { annotation ->
            if (annotation.isDeleted || annotation.anchorStatus == "review") null else Decoration(
                id = annotation.id,
                locator = annotation.locator,
                style = Decoration.Style.Highlight(annotation.color.tint(effectivePreferences().theme)),
            )
        }
        lifecycleScope.launch { fragment.applyDecorations(decorations, ANNOTATION_GROUP) }
    }

    private fun attemptAnnotationReanchoring() {
        val opened = publication ?: return
        val pending = readerContext.annotationState.annotations.filter {
            !it.isDeleted && it.anchorStatus == "review" && it.anchorReason == "asset-revision"
        }
        if (pending.isEmpty()) return
        lifecycleScope.launch {
            for (annotation in pending) {
                val locator = uniqueReanchorCandidate(opened, annotation) ?: continue
                acceptAutomaticReanchor(annotation, locator)
            }
        }
    }

    private suspend fun uniqueReanchorCandidate(
        opened: Publication,
        annotation: ReaderAnnotationRecord,
    ): Locator? {
        val exact = matchingReanchorCandidates(opened, annotation)
        if (exact.size == 1) return exact.first()
        if (exact.size < 2) return null
        val before = normalizedAnchorText(annotation.prefix).takeLast(80)
        val after = normalizedAnchorText(annotation.suffix).take(80)
        if (before.isEmpty() && after.isEmpty()) return null
        val contextual = exact.filter { candidate ->
            (before.isEmpty() || normalizedAnchorText(candidate.text.before.orEmpty()).endsWith(before)) &&
                (after.isEmpty() || normalizedAnchorText(candidate.text.after.orEmpty()).startsWith(after))
        }
        return contextual.singleOrNull()
    }

    private suspend fun matchingReanchorCandidates(
        opened: Publication,
        annotation: ReaderAnnotationRecord,
    ): List<Locator> {
        val iterator = opened.search(annotation.quote) ?: return emptyList()
        val candidates = mutableListOf<Locator>()
        while (candidates.size < 50) {
            val page = iterator.next().getOrNull() ?: break
            candidates += page.locators.take(50 - candidates.size)
        }
        iterator.close()
        val quote = normalizedAnchorText(annotation.quote)
        return candidates.filter { normalizedAnchorText(it.text.highlight.orEmpty()) == quote }
    }

    private fun acceptAutomaticReanchor(annotation: ReaderAnnotationRecord, locator: Locator) {
        val stored = readerContext.annotationState.annotations.firstOrNull {
            it.id == annotation.id && it.anchorStatus == "review" && !it.isDeleted
        } ?: return
        val timestamp = ReaderOutbox.timestamp()
        stored.locator = locator
        stored.anchorStatus = "reanchored"
        stored.anchorReason = null
        stored.updatedAt = timestamp
        readerContext.annotationState.updatedAt = timestamp
        ReaderOutbox.enqueueAnnotation(
            this,
            readerContext,
            sessionId,
            "upsert",
            stored.id,
            stored,
        )
        applyAnnotationDecorations()
    }

    private fun normalizedAnchorText(value: String): String = value
        .trim()
        .replace(Regex("\\s+"), " ")
        .lowercase()

    private fun updateBookmarkButton() {
        if (!::bookmarkButton.isInitialized) return
        val locator = lastLocator ?: navigator?.currentLocator?.value
        val bookmarked = locator != null && readerContext.navigationState.bookmarks.any {
            samePassage(it.locator, locator)
        }
        bookmarkButton.text = if (bookmarked) "Bookmarked" else "Bookmark"
        bookmarkButton.contentDescription = if (bookmarked) "Remove bookmark" else "Add bookmark"
        bookmarkButton.isSelected = bookmarked
    }

    private fun samePassage(left: Locator, right: Locator): Boolean {
        if (left.href != right.href) return false
        if (left.locations.fragments.isNotEmpty() && left.locations.fragments == right.locations.fragments) return true
        val leftProgression = left.locations.progression
        val rightProgression = right.locations.progression
        return if (leftProgression == null || rightProgression == null) {
            left.locations.fragments == right.locations.fragments
        } else {
            kotlin.math.abs(leftProgression - rightProgression) < 0.002
        }
    }

    private fun updateHistoryButton() {
        if (!::historyButton.isInitialized) return
        historyButton.isEnabled = navigationHistory.isNotEmpty()
        historyButton.contentDescription = if (navigationHistory.isEmpty()) {
            "No previous passage"
        } else {
            "Return to previous passage, ${navigationHistory.size} available"
        }
    }

    private fun updateProgress(locator: Locator) {
        val progression = locator.locations.totalProgression
        progress.text = progression?.let { "${(it * 100).toInt()}%" }
            ?: locator.title
            ?: "Reading"
        if (!scrubbing && progression != null) scrubber.progress = (progression * 1000).toInt()
    }

    override fun onJumpToLocator(locator: Locator) {
        if (restoringHistory) {
            restoringHistory = false
            return
        }
        val origin = pendingJumpOrigin
        pendingJumpOrigin = null
        if (origin != null && !samePassage(origin, locator)) {
            navigationHistory.addLast(origin)
            while (navigationHistory.size > 50) navigationHistory.removeFirst()
            updateHistoryButton()
        }
    }

    override fun shouldFollowInternalLink(
        link: Link,
        context: HyperlinkNavigator.LinkContext?,
    ): Boolean {
        if (context is HyperlinkNavigator.FootnoteContext) {
            val note = Html.fromHtml(
                context.noteContent.take(16_000),
                Html.FROM_HTML_MODE_LEGACY,
            ).toString().trim()
            AlertDialog.Builder(this)
                .setTitle(link.title ?: "Footnote")
                .setMessage(note.ifBlank { "This note has no readable text." })
                .setPositiveButton("Return to passage", null)
                .show()
            return false
        }
        pendingJumpOrigin = lastLocator ?: navigator?.currentLocator?.value
        return true
    }

    override fun onExternalLinkActivated(url: AbsoluteUrl) {
        if (!url.isHttp) {
            readerMessage("Link unavailable", "Wovenleaf only hands web links to your browser.")
            return
        }
        val uri = url.toUri()
        val destination = uri.host ?: "this website"
        AlertDialog.Builder(this)
            .setTitle("Leave Wovenleaf?")
            .setMessage("Open $destination in your browser? The book file stays private.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open browser") { _, _ ->
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    .onFailure { readerMessage("Browser unavailable", "No app can open this web link.") }
            }
            .show()
    }

    override fun onPageLoaded() {
        lifecycleScope.launch { navigator?.evaluateJavascript(IMAGE_ACTIVATION_SCRIPT) }
    }

    private inner class ReaderImageBridge(private val resource: Link) {
        @JavascriptInterface
        fun openImage(source: String, alternative: String?, caption: String?) {
            lifecycleScope.launch { showImage(resource, source, alternative, caption) }
        }
    }

    private suspend fun showImage(
        resource: Link,
        source: String,
        alternative: String?,
        caption: String?,
    ) {
        val relative = Url(source)
        val resolved = relative?.let { resource.url().resolve(it) }
        if (resolved == null) {
            readerMessage("Image unavailable", "This image address is invalid.")
            return
        }
        val opened = publication
        val bytes = opened?.get(resolved)?.read()?.getOrNull()
        if (bytes == null || bytes.isEmpty() || bytes.size > 32 * 1024 * 1024) {
            readerMessage("Image unavailable", "This image is missing or cannot be opened safely.")
            return
        }
        val mediaType = opened.linkWithHref(resolved)?.mediaType?.toString() ?: "image/*"
        val description = alternative?.takeIf(String::isNotBlank) ?: "Book image"
        val escapedDescription = TextUtils.htmlEncode(description)
        val escapedCaption = TextUtils.htmlEncode(caption.orEmpty())
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val webView = WebView(this).apply {
            contentDescription = description
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.blockNetworkLoads = true
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            setBackgroundColor(ReaderPalette(effectivePreferences().theme, isHighContrast(this@WovenleafReaderActivity)).page)
            loadDataWithBaseURL(
                null,
                """<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=8,user-scalable=yes"><style>html,body{height:100%;margin:0;background:transparent}body{display:flex;flex-direction:column;justify-content:center;align-items:center}img{max-width:100%;height:auto}p{font:16px serif;padding:12px;color:#555}</style><img src="data:$mediaType;base64,$encoded" alt="$escapedDescription"><p>$escapedCaption</p>""",
                "text/html",
                "UTF-8",
                null,
            )
        }
        AlertDialog.Builder(this)
            .setTitle(description)
            .setView(webView)
            .setPositiveButton("Done", null)
            .setOnDismissListener { webView.destroy() }
            .show()
    }

    private fun readerMessage(title: String, message: String) {
        AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show()
    }

    private fun showCompatibilityNotice() {
        val notices = readerContext.compatibility?.notices.orEmpty()
        if (notices.isEmpty()) return
        AlertDialog.Builder(this)
            .setTitle("Reading this edition")
            .setMessage(notices.joinToString("\n\n"))
            .setPositiveButton("Continue") { _, _ ->
                content.sendAccessibilityEvent(
                    android.view.accessibility.AccessibilityEvent.TYPE_VIEW_FOCUSED,
                )
            }
            .show()
    }

    private fun flushLocation() {
        checkpointJob?.cancel()
        checkpointJob = null
        val locator = lastLocator ?: navigator?.currentLocator?.value ?: return
        ReaderOutbox.enqueue(this, "location", readerContext, sessionId, locator.toJSON())
    }

    private fun closeReader() {
        flushPreference()
        flushLocation()
        if (!sessionClosed) {
            sessionClosed = true
            ReaderOutbox.enqueue(
                this,
                "session",
                readerContext,
                sessionId,
                (lastLocator ?: navigator?.currentLocator?.value)?.toJSON(),
                startedAt = sessionStartedAt,
                endedAt = ReaderOutbox.timestamp(),
                activeDurationMs = (SystemClock.elapsedRealtime() - sessionStartedUptime).coerceAtLeast(0L),
            )
        }
        finish()
    }

    private fun showRecovery(message: String) {
        loading.visibility = View.GONE
        AlertDialog.Builder(this)
            .setTitle("Book needs attention")
            .setMessage("$message Re-import this edition to restore reading. Notes and reading history were kept.")
            .setCancelable(false)
            .setPositiveButton("Back to library") { _, _ -> finish() }
            .show()
    }

    private fun readContext(): ReaderContext? {
        val bookId = intent.getStringExtra(ReaderContract.BOOK_ID) ?: return null
        val editionId = intent.getStringExtra(ReaderContract.EDITION_ID) ?: return null
        val assetId = intent.getStringExtra(ReaderContract.ASSET_ID) ?: return null
        val fingerprint = intent.getStringExtra(ReaderContract.ASSET_FINGERPRINT) ?: return null
        val title = intent.getStringExtra(ReaderContract.TITLE) ?: return null
        val globalPreferences = intent.getStringExtra(ReaderContract.GLOBAL_PREFERENCES)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.let(WovenleafReaderPreferences::fromJson)
            ?: return null
        val bookPreferences = intent.getStringExtra(ReaderContract.BOOK_PREFERENCES)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.let(WovenleafReaderPreferences::fromJson)
        val navigationState = intent.getStringExtra(ReaderContract.NAVIGATION_STATE)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.let(ReaderNavigationState::fromJson)
            ?: return null
        val annotationState = intent.getStringExtra(ReaderContract.ANNOTATION_STATE)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.let(ReaderAnnotationState::fromJson)
            ?: return null
        val compatibility = intent.getStringExtra(ReaderContract.COMPATIBILITY)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.let(ReaderPublicationProfile::fromJson)
        return ReaderContext(
            bookId,
            editionId,
            assetId,
            fingerprint,
            title,
            compatibility,
            globalPreferences,
            bookPreferences,
            navigationState,
            annotationState,
        )
    }

    private fun effectivePreferences() = readerContext.bookPreferences ?: readerContext.globalPreferences

    private fun savePreferences(
        scope: ReaderPreferenceScope,
        preferences: WovenleafReaderPreferences?,
    ) {
        if (pendingPreference?.first != null && pendingPreference?.first != scope) flushPreference()
        if (scope == ReaderPreferenceScope.GLOBAL && preferences != null) {
            readerContext.globalPreferences = preferences
        } else if (scope == ReaderPreferenceScope.BOOK) {
            readerContext.bookPreferences = preferences
        }
        navigator?.submitPreferences(readerPreferences())
        applyChromePalette()
        pendingPreference = scope to preferences
        preferenceJob?.cancel()
        preferenceJob = lifecycleScope.launch {
            delay(350)
            flushPreference()
        }
    }

    private fun flushPreference() {
        preferenceJob?.cancel()
        preferenceJob = null
        val pending = pendingPreference ?: return
        pendingPreference = null
        ReaderOutbox.enqueuePreference(
            this,
            readerContext,
            sessionId,
            pending.first,
            pending.second,
        )
    }

    private fun applyChromePalette() {
        val preferences = effectivePreferences()
        val palette = ReaderPalette(preferences.theme, isHighContrast(this))
        chrome.setBackgroundColor(palette.page)
        topChrome.setBackgroundColor(palette.page)
        bottomChrome.setBackgroundColor(palette.page)
        titleView.setTextColor(palette.ink)
        progress.setTextColor(palette.secondaryInk)
        recolorButtons(topChrome, palette)
        recolorButtons(bottomChrome, palette)
        texture.theme = preferences.theme
        texture.highContrast = isHighContrast(this)
        applyAnnotationDecorations()
        window.statusBarColor = palette.page
        window.navigationBarColor = palette.page
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val lightBars = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(
                if (preferences.theme == "graphite") 0 else lightBars,
                lightBars,
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (preferences.theme == "graphite") 0 else
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
    }

    private fun recolorButtons(root: ViewGroup, palette: ReaderPalette) {
        for (index in 0 until root.childCount) {
            when (val child = root.getChildAt(index)) {
                is Button -> child.setTextColor(palette.ink)
                is ViewGroup -> recolorButtons(child, palette)
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val ANNOTATION_GROUP = "annotations"
        private const val SELECTION_COPY = 9_301
        private const val SELECTION_HIGHLIGHT = 9_302
        private const val SELECTION_NOTE = 9_303
        private const val SELECTION_READ_ALOUD = 9_304
        private const val IMAGE_ACTIVATION_SCRIPT = """
            (() => {
              if (window.__wovenleafImageZoom) return;
              window.__wovenleafImageZoom = true;
              document.addEventListener('click', event => {
                const image = event.target && event.target.closest ? event.target.closest('img') : null;
                if (!image) return;
                const source = image.getAttribute('src');
                if (!source || !window.WovenleafImages) return;
                const figure = image.closest('figure');
                const caption = figure && figure.querySelector('figcaption');
                window.WovenleafImages.openImage(source, image.getAttribute('alt') || '', caption ? caption.textContent : '');
                event.preventDefault();
                event.stopPropagation();
              }, true);
            })();
        """
    }
}
