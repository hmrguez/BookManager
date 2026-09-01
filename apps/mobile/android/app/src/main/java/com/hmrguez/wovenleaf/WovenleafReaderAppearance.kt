package com.hmrguez.wovenleaf

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.Color as ReadiumColor
import org.readium.r2.navigator.preferences.ColumnCount
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.ImageFilter
import org.readium.r2.navigator.preferences.TextAlign
import org.readium.r2.navigator.preferences.Theme
import kotlin.math.roundToInt

internal enum class ReaderPreferenceScope(val wireValue: String) {
    GLOBAL("global"),
    BOOK("book"),
}

internal data class WovenleafReaderPreferences(
    val version: Int = 1,
    val fontFamily: String = "literary",
    val fontSize: Double = 1.0,
    val fontWeight: Double = 1.0,
    val lineHeight: Double = 1.5,
    val pageMargins: Double = 1.15,
    val textAlign: String = "justify",
    val hyphens: Boolean = true,
    val columnCount: String = "auto",
    val layout: String = "paginated",
    val theme: String = "paper",
    val publisherStyles: Boolean = false,
) {
    val validated: WovenleafReaderPreferences
        get() = copy(
            version = 1,
            fontFamily = fontFamily.takeIf { it in FONT_FAMILIES } ?: "literary",
            fontSize = fontSize.coerceIn(0.8, 2.0),
            fontWeight = fontWeight.coerceIn(0.75, 1.5),
            lineHeight = lineHeight.coerceIn(1.2, 1.9),
            pageMargins = pageMargins.coerceIn(0.4, 2.5),
            textAlign = textAlign.takeIf { it in ALIGNMENTS } ?: "justify",
            columnCount = columnCount.takeIf { it in COLUMNS } ?: "auto",
            layout = layout.takeIf { it in LAYOUTS } ?: "paginated",
            theme = theme.takeIf { it in THEMES } ?: "paper",
        )

    fun toJson(): JSONObject = JSONObject().apply {
        put("version", version)
        put("fontFamily", fontFamily)
        put("fontSize", fontSize)
        put("fontWeight", fontWeight)
        put("lineHeight", lineHeight)
        put("pageMargins", pageMargins)
        put("textAlign", textAlign)
        put("hyphens", hyphens)
        put("columnCount", columnCount)
        put("layout", layout)
        put("theme", theme)
        put("publisherStyles", publisherStyles)
    }

    @OptIn(org.readium.r2.shared.ExperimentalReadiumApi::class)
    fun toReadium(compactWidth: Boolean, highContrast: Boolean = false): EpubPreferences {
        val palette = ReaderPalette(theme, highContrast)
        val family = if (publisherStyles) null else when (fontFamily) {
            "sans" -> FontFamily.SANS_SERIF
            "mono" -> FontFamily.IA_WRITER_DUOSPACE
            "accessible" -> FontFamily.OPEN_DYSLEXIC
            else -> FontFamily.SERIF
        }
        val columns = if (layout == "scroll") ColumnCount.ONE else when (columnCount) {
            "one" -> ColumnCount.ONE
            "two" -> if (compactWidth) ColumnCount.ONE else ColumnCount.TWO
            else -> ColumnCount.AUTO
        }
        return EpubPreferences(
            backgroundColor = ReadiumColor(palette.page),
            columnCount = columns,
            fontFamily = family,
            fontSize = fontSize,
            fontWeight = fontWeight,
            hyphens = if (publisherStyles) null else hyphens,
            imageFilter = if (theme == "graphite") ImageFilter.DARKEN else null,
            lineHeight = if (publisherStyles) null else lineHeight,
            pageMargins = pageMargins,
            publisherStyles = publisherStyles,
            scroll = layout == "scroll",
            textAlign = if (publisherStyles) null else if (textAlign == "justify") TextAlign.JUSTIFY else TextAlign.START,
            textColor = ReadiumColor(palette.ink),
            textNormalization = true,
            theme = if (theme == "graphite") Theme.DARK else Theme.LIGHT,
        )
    }

    companion object {
        val STANDARD = WovenleafReaderPreferences()
        private val FONT_FAMILIES = setOf("literary", "sans", "mono", "accessible")
        private val ALIGNMENTS = setOf("start", "justify")
        private val COLUMNS = setOf("auto", "one", "two")
        private val LAYOUTS = setOf("paginated", "scroll")
        private val THEMES = setOf("paper", "white", "graphite")

        fun fromJson(json: JSONObject?): WovenleafReaderPreferences? {
            if (json == null) return null
            return runCatching {
                WovenleafReaderPreferences(
                    version = json.optInt("version", 1),
                    fontFamily = json.getString("fontFamily"),
                    fontSize = json.getDouble("fontSize"),
                    fontWeight = json.getDouble("fontWeight"),
                    lineHeight = json.getDouble("lineHeight"),
                    pageMargins = json.getDouble("pageMargins"),
                    textAlign = json.getString("textAlign"),
                    hyphens = json.getBoolean("hyphens"),
                    columnCount = json.getString("columnCount"),
                    layout = json.getString("layout"),
                    theme = json.getString("theme"),
                    publisherStyles = json.getBoolean("publisherStyles"),
                ).validated
            }.getOrNull()
        }
    }
}

internal class ReaderPalette private constructor(colors: IntArray) {
    val page: Int = colors[0]
    val raised: Int = colors[1]
    val ink: Int = colors[2]
    val secondaryInk: Int = colors[3]
    val rule: Int = colors[4]
    val inverseInk: Int = colors[5]

    constructor(theme: String, highContrast: Boolean = false) : this(
        when {
            theme == "graphite" && highContrast -> intArrayOf(
                Color.rgb(9, 10, 9), Color.rgb(17, 18, 16), Color.WHITE,
                Color.rgb(224, 224, 217), Color.rgb(181, 182, 176), Color.rgb(9, 10, 9),
            )
            theme == "graphite" -> intArrayOf(
                Color.rgb(32, 33, 31), Color.rgb(42, 43, 40), Color.rgb(223, 223, 215),
                Color.rgb(180, 180, 172), Color.rgb(85, 86, 80), Color.rgb(32, 33, 31),
            )
            theme == "white" && highContrast -> intArrayOf(
                Color.WHITE, Color.WHITE, Color.BLACK,
                Color.rgb(37, 38, 35), Color.rgb(48, 49, 46), Color.WHITE,
            )
            theme == "white" -> intArrayOf(
                Color.rgb(248, 248, 245), Color.WHITE, Color.rgb(32, 33, 31),
                Color.rgb(91, 92, 88), Color.rgb(170, 175, 170), Color.WHITE,
            )
            highContrast -> intArrayOf(
                Color.rgb(242, 241, 235), Color.WHITE, Color.rgb(9, 10, 8),
                Color.rgb(41, 42, 39), Color.rgb(52, 53, 48), Color.WHITE,
            )
            else -> intArrayOf(
                Color.rgb(238, 237, 231), Color.rgb(247, 246, 241), Color.rgb(37, 38, 34),
                Color.rgb(93, 94, 88), Color.rgb(167, 166, 159), Color.rgb(247, 246, 241),
            )
        },
    )
}

internal class ReaderSettingsDialog(
    private val activity: AppCompatActivity,
    globalPreferences: WovenleafReaderPreferences,
    bookPreferences: WovenleafReaderPreferences?,
    private val compactWidth: Boolean,
    private val onSave: (ReaderPreferenceScope, WovenleafReaderPreferences?) -> Unit,
) {
    private var global = globalPreferences
    private var book = bookPreferences
    private var scope = if (bookPreferences == null) ReaderPreferenceScope.GLOBAL else ReaderPreferenceScope.BOOK
    private val dialog = Dialog(activity)
    private val content = LinearLayout(activity)
    private val labels = mutableListOf<TextView>()
    private val secondaryLabels = mutableListOf<TextView>()
    private val segments = mutableListOf<SegmentedControl>()
    private lateinit var scopeSegment: SegmentedControl
    private lateinit var themeSegment: SegmentedControl
    private lateinit var alignmentSegment: SegmentedControl
    private lateinit var columnSegment: SegmentedControl
    private lateinit var layoutSegment: SegmentedControl
    private lateinit var typefacePicker: TypefacePicker
    private lateinit var sizeSlider: SeekBar
    private lateinit var weightSlider: SeekBar
    private lateinit var lineSlider: SeekBar
    private lateinit var marginSlider: SeekBar
    private lateinit var sizeValue: TextView
    private lateinit var weightValue: TextView
    private lateinit var lineValue: TextView
    private lateinit var marginValue: TextView
    private lateinit var hyphenSwitch: Switch
    private lateinit var publisherSwitch: Switch
    private var syncing = false

    private val preferences: WovenleafReaderPreferences
        get() = if (scope == ReaderPreferenceScope.BOOK) book ?: global else global

    fun show() {
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        build()
        dialog.setContentView(content)
        dialog.setOnShowListener {
            dialog.window?.apply {
                setBackgroundDrawable(ColorDrawableCompat.transparent())
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                setGravity(Gravity.BOTTOM)
                navigationBarColor = palette().page
            }
        }
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun build() {
        content.orientation = LinearLayout.VERTICAL
        val scroll = ScrollView(activity).apply { isFillViewport = true }
        val stack = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(30))
        }
        scroll.addView(stack, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(scroll, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, maxDialogHeight()))

        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(text("Reading surface", 22f, Typeface.SERIF), LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(Button(activity).apply {
            text = "Done"
            isAllCaps = false
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { dialog.dismiss() }
        })
        stack.addView(header)
        stack.addView(secondary("Live preview keeps the open passage in place. Save a quiet default or tune only this book."))

        scopeSegment = segmented(listOf("All books", "This book"), if (scope == ReaderPreferenceScope.GLOBAL) 0 else 1) { index ->
            val next = if (index == 0) ReaderPreferenceScope.GLOBAL else ReaderPreferenceScope.BOOK
            if (next == scope) return@segmented
            scope = next
            if (next == ReaderPreferenceScope.BOOK && book == null) {
                book = global
                onSave(ReaderPreferenceScope.BOOK, book)
            } else if (next == ReaderPreferenceScope.GLOBAL && book != null) {
                book = null
                onSave(ReaderPreferenceScope.BOOK, null)
            }
            sync()
        }
        section(stack, "Apply to", scopeSegment.view)

        themeSegment = segmented(listOf("Paper", "White", "Graphite"), 0) { index ->
            mutate { it.copy(theme = listOf("paper", "white", "graphite")[index]) }
        }
        section(stack, "Paper", themeSegment.view)

        typefacePicker = TypefacePicker(activity) { index ->
            if (!syncing) mutate { it.copy(fontFamily = listOf("literary", "sans", "mono", "accessible")[index]) }
        }
        section(stack, "Typeface", typefacePicker.view)

        val size = sliderRow("Size", 0.8, 2.0) { current, value -> current.copy(fontSize = value) }
        sizeSlider = size.slider
        sizeValue = size.value
        val weight = sliderRow("Ink weight", 0.75, 1.5) { current, value -> current.copy(fontWeight = value) }
        weightSlider = weight.slider
        weightValue = weight.value
        val line = sliderRow("Line spacing", 1.2, 1.9) { current, value -> current.copy(lineHeight = value) }
        lineSlider = line.slider
        lineValue = line.value
        section(stack, "Type", size.view, weight.view, line.view)

        val margin = sliderRow("Margins", 0.4, 2.5) { current, value -> current.copy(pageMargins = value) }
        marginSlider = margin.slider
        marginValue = margin.value
        alignmentSegment = segmented(listOf("Ragged", "Justified"), 0) { index ->
            mutate { it.copy(textAlign = if (index == 0) "start" else "justify") }
        }
        hyphenSwitch = Switch(activity).apply {
            text = "Hyphenation"
            setOnCheckedChangeListener { _, checked -> if (!syncing) mutate { it.copy(hyphens = checked) } }
        }
        labels += hyphenSwitch
        section(stack, "Composition", margin.view, labelled("Alignment", alignmentSegment.view), hyphenSwitch)

        layoutSegment = segmented(listOf("Pages", "Scroll"), 0) { index ->
            mutate { it.copy(layout = if (index == 0) "paginated" else "scroll") }
        }
        columnSegment = segmented(listOf("Auto", "One", "Two"), 0) { index ->
            mutate { it.copy(columnCount = listOf("auto", "one", "two")[index]) }
        }
        section(stack, "Movement", labelled("Reading mode", layoutSegment.view), labelled("Columns", columnSegment.view))

        publisherSwitch = Switch(activity).apply {
            text = "Use publisher styling"
            setOnCheckedChangeListener { _, checked -> if (!syncing) mutate { it.copy(publisherStyles = checked) } }
        }
        labels += publisherSwitch
        section(
            stack,
            "Book design",
            publisherSwitch,
            secondary("Original styling remains available, while Wovenleaf keeps a safe text size and readable ink contrast."),
        )
        section(
            stack,
            "Ambient light",
            secondary("Match the page to the room: lower device brightness until the page stops glowing. Wovenleaf leaves system brightness under your control, like a front light on an e-reader."),
        )

        stack.addView(Button(activity).apply {
            text = "Reset to quiet paper"
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                if (scope == ReaderPreferenceScope.BOOK) {
                    book = null
                    scope = ReaderPreferenceScope.GLOBAL
                    onSave(ReaderPreferenceScope.BOOK, null)
                } else {
                    global = WovenleafReaderPreferences.STANDARD
                    onSave(ReaderPreferenceScope.GLOBAL, global)
                }
                sync()
            }
        })
        sync()
    }

    private fun mutate(change: (WovenleafReaderPreferences) -> WovenleafReaderPreferences) {
        if (scope == ReaderPreferenceScope.BOOK) {
            book = change(book ?: global).validated
            onSave(ReaderPreferenceScope.BOOK, book)
        } else {
            global = change(global).validated
            onSave(ReaderPreferenceScope.GLOBAL, global)
        }
        sync()
    }

    private fun sync() {
        syncing = true
        val value = preferences
        scopeSegment.select(if (scope == ReaderPreferenceScope.GLOBAL) 0 else 1)
        themeSegment.select(listOf("paper", "white", "graphite").indexOf(value.theme).coerceAtLeast(0))
        typefacePicker.select(listOf("literary", "sans", "mono", "accessible").indexOf(value.fontFamily).coerceAtLeast(0))
        setSlider(sizeSlider, sizeValue, value.fontSize, 0.8, 2.0, percent = true)
        setSlider(weightSlider, weightValue, value.fontWeight, 0.75, 1.5, percent = true)
        setSlider(lineSlider, lineValue, value.lineHeight, 1.2, 1.9)
        setSlider(marginSlider, marginValue, value.pageMargins, 0.4, 2.5)
        alignmentSegment.select(if (value.textAlign == "start") 0 else 1)
        hyphenSwitch.isChecked = value.hyphens
        columnSegment.select(listOf("auto", "one", "two").indexOf(value.columnCount).coerceAtLeast(0))
        layoutSegment.select(if (value.layout == "paginated") 0 else 1)
        publisherSwitch.isChecked = value.publisherStyles
        val advancedEnabled = !value.publisherStyles
        listOf(typefacePicker.view, weightSlider, lineSlider, alignmentSegment.view, hyphenSwitch).forEach {
            it.isEnabled = advancedEnabled
            it.alpha = if (advancedEnabled) 1f else 0.42f
        }
        val columnsEnabled = value.layout == "paginated"
        columnSegment.setAllEnabled(columnsEnabled)
        columnSegment.view.alpha = if (columnsEnabled) 1f else 0.42f
        columnSegment.setEnabled(2, columnsEnabled && !compactWidth)
        syncing = false
        applyPalette()
    }

    private fun applyPalette() {
        val palette = palette()
        content.background = GradientDrawable().apply {
            setColor(palette.page)
            cornerRadii = floatArrayOf(dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), 0f, 0f, 0f, 0f)
        }
        labels.forEach { it.setTextColor(palette.ink) }
        secondaryLabels.forEach { it.setTextColor(palette.secondaryInk) }
        segments.forEach { it.applyPalette(palette) }
        typefacePicker.applyPalette(palette)
        listOf(sizeSlider, weightSlider, lineSlider, marginSlider).forEach {
            it.progressTintList = ColorStateList.valueOf(palette.ink)
            it.thumbTintList = ColorStateList.valueOf(palette.ink)
            it.progressBackgroundTintList = ColorStateList.valueOf(palette.rule)
        }
        listOf(hyphenSwitch, publisherSwitch).forEach {
            it.thumbTintList = ColorStateList.valueOf(if (it.isChecked) palette.inverseInk else palette.raised)
            it.trackTintList = ColorStateList.valueOf(if (it.isChecked) palette.ink else palette.rule)
        }
        dialog.window?.navigationBarColor = palette.page
    }

    private fun section(parent: LinearLayout, title: String, vararg views: View) {
        val heading = secondary(title.uppercase()).apply {
            textSize = 11f
            letterSpacing = 0.1f
            setTypeface(typeface, Typeface.BOLD)
        }
        parent.addView(heading, margin(top = 22, bottom = 7))
        views.forEach { parent.addView(it, margin(bottom = 8)) }
    }

    private fun labelled(title: String, control: View): View = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(text(title, 15f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(control, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.4f))
    }

    private fun sliderRow(
        title: String,
        minimum: Double,
        maximum: Double,
        onChange: ((WovenleafReaderPreferences, Double) -> WovenleafReaderPreferences),
    ): SliderRow {
        val container = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val header = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        header.addView(text(title, 15f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val value = text("", 13f, Typeface.MONOSPACE).apply { gravity = Gravity.END }
        header.addView(value)
        val slider = SeekBar(activity).apply {
            max = 100
            setOnSeekBarChangeListener(SimpleSeekBarListener { progress ->
                if (!syncing) {
                    val raw = minimum + (maximum - minimum) * progress / 100.0
                    val rounded = (raw / 0.05).roundToInt() * 0.05
                    mutate { current -> onChange(current, rounded) }
                }
            })
        }
        container.addView(header)
        container.addView(slider)
        return SliderRow(container, slider, value)
    }

    private fun segmented(labels: List<String>, selected: Int, onSelect: (Int) -> Unit): SegmentedControl {
        val control = SegmentedControl(activity, labels, selected, onSelect)
        segments += control
        return control
    }

    private fun text(value: String, size: Float, family: Typeface = Typeface.DEFAULT): TextView = TextView(activity).apply {
        text = value
        textSize = size
        typeface = family
        gravity = Gravity.CENTER_VERTICAL
        setLineSpacing(0f, 1.08f)
        labels += this
    }

    private fun secondary(value: String): TextView = text(value, 13f).apply {
        setLineSpacing(dp(2).toFloat(), 1.12f)
        secondaryLabels += this
    }

    private fun setSlider(
        slider: SeekBar,
        label: TextView,
        value: Double,
        minimum: Double,
        maximum: Double,
        percent: Boolean = false,
    ) {
        slider.progress = (((value - minimum) / (maximum - minimum)) * 100).roundToInt()
        label.text = if (percent) "${(value * 100).roundToInt()}%" else "%.2f".format(value)
    }

    private fun palette() = ReaderPalette(preferences.theme, isHighContrast(activity))

    private fun margin(top: Int = 0, bottom: Int = 0) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply {
        topMargin = dp(top)
        bottomMargin = dp(bottom)
    }

    private fun maxDialogHeight() = (activity.resources.displayMetrics.heightPixels * 0.88f).toInt()
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).roundToInt()

    private data class SliderRow(val view: View, val slider: SeekBar, val value: TextView)
}

private class TypefacePicker(
    private val context: Context,
    onSelect: (Int) -> Unit,
) {
    val view = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
    }
    private val labels = listOf("Ag   Literary", "Ag   Sans", "Ag   Mono", "Ag   Accessible")
    private val buttons = labels.mapIndexed { index, label ->
        Button(context).apply {
            text = label
            textSize = 13f
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(context, 13), 0, dp(context, 13), 0)
            typeface = when (index) {
                0 -> Typeface.create("serif", Typeface.NORMAL)
                1 -> Typeface.create("sans-serif-medium", Typeface.NORMAL)
                2 -> Typeface.MONOSPACE
                else -> Typeface.create("sans-serif", Typeface.BOLD)
            }
            minHeight = dp(context, 48)
            setOnClickListener { onSelect(index) }
        }
    }
    private var selectedIndex = 0
    private var palette = ReaderPalette("paper")

    init {
        buttons.chunked(2).forEachIndexed { rowIndex, rowButtons ->
            val row = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                if (rowIndex > 0) setPadding(0, dp(context, 7), 0, 0)
            }
            rowButtons.forEachIndexed { column, button ->
                row.addView(
                    button,
                    LinearLayout.LayoutParams(0, dp(context, 48), 1f).apply {
                        if (column > 0) leftMargin = dp(context, 7)
                    },
                )
            }
            view.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        refresh()
    }

    fun select(index: Int) {
        selectedIndex = index
        refresh()
    }

    fun applyPalette(value: ReaderPalette) {
        palette = value
        refresh()
    }

    private fun refresh() {
        buttons.forEachIndexed { index, button ->
            val selected = index == selectedIndex
            button.setTextColor(if (selected) palette.inverseInk else palette.ink)
            button.background = GradientDrawable().apply {
                setColor(if (selected) palette.ink else palette.raised)
                setStroke(dp(context, 1), if (selected) palette.ink else palette.rule)
                cornerRadius = dp(context, 10).toFloat()
            }
            button.isSelected = selected
        }
    }
}

private class SegmentedControl(
    context: Context,
    labels: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    val view = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
    private val buttons = labels.mapIndexed { index, label ->
        Button(context).apply {
            text = label
            textSize = 12f
            isAllCaps = false
            minHeight = dp(context, 42)
            setPadding(dp(context, 6), 0, dp(context, 6), 0)
            setOnClickListener { onSelect(index) }
            view.addView(this, LinearLayout.LayoutParams(0, dp(context, 42), 1f))
        }
    }
    private var selectedIndex = selected
    private var palette = ReaderPalette("paper")

    fun select(index: Int) {
        selectedIndex = index
        refresh()
    }

    fun setEnabled(index: Int, enabled: Boolean) {
        buttons.getOrNull(index)?.isEnabled = enabled
        buttons.getOrNull(index)?.alpha = if (enabled) 1f else 0.35f
    }

    fun setAllEnabled(enabled: Boolean) {
        buttons.forEach {
            it.isEnabled = enabled
            it.alpha = if (enabled) 1f else 0.35f
        }
    }

    fun applyPalette(value: ReaderPalette) {
        palette = value
        refresh()
    }

    private fun refresh() {
        buttons.forEachIndexed { index, button ->
            val selected = index == selectedIndex
            button.setTextColor(if (selected) palette.inverseInk else palette.ink)
            button.background = GradientDrawable().apply {
                setColor(if (selected) palette.ink else Color.TRANSPARENT)
                setStroke(dp(button.context, 1), palette.rule)
                cornerRadius = dp(button.context, 3).toFloat()
            }
        }
    }
}

internal class PaperTextureView(context: Context) : View(context) {
    var theme: String = "paper"
        set(value) {
            field = value
            invalidate()
        }
    var highContrast: Boolean = false
        set(value) {
            field = value
            invalidate()
        }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    init {
        isClickable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (highContrast) return
        val light = theme == "graphite"
        paint.color = if (light) Color.argb(5, 255, 255, 255) else Color.argb(5, 0, 0, 0)
        paint.strokeWidth = 0.5f / resources.displayMetrics.density
        var y = 3f
        while (y < height) {
            canvas.drawLine(0f, y, width.toFloat(), y, paint)
            y += dp(context, 8).toFloat()
        }
        paint.color = if (light) Color.argb(7, 255, 255, 255) else Color.argb(7, 0, 0, 0)
        for (row in 0..height / dp(context, 31)) {
            for (column in 0..width / dp(context, 29)) {
                if ((row * 7 + column * 11) % 9 == 0) {
                    val x = column * dp(context, 29) + (row * 13) % dp(context, 23)
                    val dotY = row * dp(context, 31) + (column * 17) % dp(context, 19)
                    canvas.drawCircle(x.toFloat(), dotY.toFloat(), 0.45f, paint)
                }
            }
        }
    }
}

private class SimpleSeekBarListener(private val onChange: (Int) -> Unit) : SeekBar.OnSeekBarChangeListener {
    override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
        if (fromUser) onChange(progress)
    }
    override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
    override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
}

internal fun isHighContrast(context: Context): Boolean = runCatching {
    Settings.Secure.getInt(context.contentResolver, "high_text_contrast_enabled", 0) == 1
}.getOrDefault(false)

private fun dp(context: Context, value: Int) = (value * context.resources.displayMetrics.density).roundToInt()

private object ColorDrawableCompat {
    fun transparent() = android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)
}
