package com.hmrguez.wovenleaf

import android.graphics.Color
import android.graphics.Typeface
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.services.isRestricted
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.shared.util.toUrl
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser
import java.io.File
import java.util.UUID

@OptIn(ExperimentalReadiumApi::class)
class WovenleafReaderActivity : AppCompatActivity() {
    private lateinit var readerContext: ReaderContext
    private lateinit var chrome: LinearLayout
    private lateinit var topChrome: LinearLayout
    private lateinit var bottomChrome: LinearLayout
    private lateinit var content: FrameLayout
    private lateinit var progress: TextView
    private lateinit var titleView: TextView
    private lateinit var appearanceButton: Button
    private lateinit var loading: ProgressBar
    private lateinit var texture: PaperTextureView
    private var publication: Publication? = null
    private var navigator: EpubNavigatorFragment? = null
    private var lastLocator: Locator? = null
    private var locationJob: Job? = null
    private var checkpointJob: Job? = null
    private var preferenceJob: Job? = null
    private var pendingPreference: Pair<ReaderPreferenceScope, WovenleafReaderPreferences?>? = null
    private val sessionId = "reading-session:reader:${UUID.randomUUID().toString().lowercase()}"
    private val sessionStartedAt = ReaderOutbox.timestamp()
    private val sessionStartedUptime = SystemClock.elapsedRealtime()
    private var sessionClosed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        supportFragmentManager.fragmentFactory = EpubNavigatorFragment.createDummyFactory()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        readerContext = readContext() ?: run {
            finish()
            return
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
        if (isFinishing) publication?.close()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        closeReader()
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
        supportFragmentManager.fragmentFactory = factory.createFragmentFactory(
            initialLocator = initialLocator,
            initialPreferences = readerPreferences(),
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
        loading.visibility = View.GONE
        texture.bringToFront()

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
                checkpointJob?.cancel()
                checkpointJob = launch {
                    delay(750)
                    flushLocation()
                }
            }
        }
    }

    private fun readerPreferences() = effectivePreferences().toReadium(
        compactWidth = resources.configuration.screenWidthDp < 700,
        highContrast = isHighContrast(this),
    )

    private fun buildReaderChrome() {
        chrome = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        topChrome = LinearLayout(this).apply {
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
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(8))
        }
        bottomChrome.addView(textButton("Previous") { navigator?.goBackward(animated = true) })
        progress = TextView(this).apply {
            text = "Opening…"
            textSize = 12f
            typeface = Typeface.MONOSPACE
            gravity = Gravity.CENTER
        }
        bottomChrome.addView(progress, LinearLayout.LayoutParams(0, dp(48), 1f))
        bottomChrome.addView(textButton("Next") { navigator?.goForward(animated = true) })
        chrome.addView(bottomChrome, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
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

    private fun updateProgress(locator: Locator) {
        progress.text = locator.locations.totalProgression?.let { "${(it * 100).toInt()}%" }
            ?: locator.title
            ?: "Reading"
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
        return ReaderContext(
            bookId,
            editionId,
            assetId,
            fingerprint,
            title,
            globalPreferences,
            bookPreferences,
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
}
