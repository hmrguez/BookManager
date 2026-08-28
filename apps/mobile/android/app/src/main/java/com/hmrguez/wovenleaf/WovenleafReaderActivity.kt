package com.hmrguez.wovenleaf

import android.graphics.Color
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
import org.readium.r2.navigator.epub.EpubPreferences
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
    private lateinit var content: FrameLayout
    private lateinit var progress: TextView
    private lateinit var layoutButton: Button
    private lateinit var loading: ProgressBar
    private var publication: Publication? = null
    private var navigator: EpubNavigatorFragment? = null
    private var lastLocator: Locator? = null
    private var locationJob: Job? = null
    private var checkpointJob: Job? = null
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
        flushLocation()
        super.onPause()
    }

    override fun onDestroy() {
        checkpointJob?.cancel()
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

    private fun readerPreferences() = EpubPreferences(
        lineHeight = 1.5,
        pageMargins = 1.15,
        publisherStyles = false,
        scroll = readerContext.layout == "scroll",
    )

    private fun buildReaderChrome() {
        val paper = Color.rgb(246, 242, 230)
        val ink = Color.rgb(42, 39, 32)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(paper)
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        top.addView(textButton("Library") { closeReader() })
        top.addView(TextView(this).apply {
            text = readerContext.title
            setTextColor(ink)
            textSize = 16f
            maxLines = 1
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        layoutButton = textButton(if (readerContext.layout == "scroll") "Pages" else "Scroll") {
            toggleLayout()
        }
        top.addView(layoutButton)
        root.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64)))

        content = FrameLayout(this).apply { id = View.generateViewId() }
        loading = ProgressBar(this)
        content.addView(loading, FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(8))
        }
        bottom.addView(textButton("Previous") { navigator?.goBackward(animated = true) })
        progress = TextView(this).apply {
            text = "Opening…"
            setTextColor(Color.rgb(99, 93, 79))
            textSize = 12f
            gravity = Gravity.CENTER
        }
        bottom.addView(progress, LinearLayout.LayoutParams(0, dp(48), 1f))
        bottom.addView(textButton("Next") { navigator?.goForward(animated = true) })
        root.addView(bottom, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        setContentView(root)
    }

    private fun textButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        setTextColor(Color.rgb(42, 39, 32))
        setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { action() }
    }

    private fun toggleLayout() {
        readerContext.layout = if (readerContext.layout == "scroll") "paginated" else "scroll"
        navigator?.submitPreferences(EpubPreferences(scroll = readerContext.layout == "scroll"))
        layoutButton.text = if (readerContext.layout == "scroll") "Pages" else "Scroll"
        flushLocation()
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
        val layout = intent.getStringExtra(ReaderContract.LAYOUT) ?: "paginated"
        return ReaderContext(bookId, editionId, assetId, fingerprint, title, layout)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
