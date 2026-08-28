package com.hmrguez.wovenleaf

import android.graphics.Color
import android.graphics.Typeface
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import org.readium.r2.shared.publication.Locator

internal enum class ReaderAnnotationColor(val wireValue: String, val label: String) {
    OCHRE("ochre", "Ochre"),
    SAGE("sage", "Sage"),
    BLUE("blue", "Slate"),
    ROSE("rose", "Rose");

    fun tint(theme: String): Int {
        val value = when (this to theme) {
            OCHRE to "graphite" -> "#E7BE69"
            SAGE to "graphite" -> "#A8C49B"
            BLUE to "graphite" -> "#91B7D0"
            ROSE to "graphite" -> "#D7A19C"
            OCHRE to theme -> "#C39B47"
            SAGE to theme -> "#789269"
            BLUE to theme -> "#668BA5"
            ROSE to theme -> "#AD7672"
            else -> "#C39B47"
        }
        return Color.parseColor(value)
    }

    companion object {
        fun fromWire(value: String): ReaderAnnotationColor? = entries.firstOrNull { it.wireValue == value }
    }
}

internal data class ReaderAnnotationRecord(
    val id: String,
    val bookId: String,
    var editionId: String,
    var assetId: String,
    var assetFingerprint: String,
    var locator: Locator,
    val quote: String,
    val prefix: String,
    val suffix: String,
    val chapter: String?,
    var color: ReaderAnnotationColor,
    var note: String,
    var tags: List<String>,
    val createdAt: String,
    var updatedAt: String,
    var deletedAt: String?,
    var anchorStatus: String,
    var previousAssetFingerprint: String?,
    var anchorReason: String?,
    val platform: String,
    val toolkitVersion: String,
) {
    val isDeleted: Boolean get() = deletedAt != null

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("bookId", bookId)
        put("editionId", editionId)
        put("assetId", assetId)
        put("assetFingerprint", assetFingerprint)
        put("locator", locator.toJSON())
        put("quote", quote)
        put("prefix", prefix)
        put("suffix", suffix)
        chapter?.let { put("chapter", it) }
        put("color", color.wireValue)
        put("note", note)
        put("tags", JSONArray(tags))
        put("createdAt", createdAt)
        put("updatedAt", updatedAt)
        deletedAt?.let { put("deletedAt", it) }
        put("anchor", JSONObject().apply {
            put("status", anchorStatus)
            previousAssetFingerprint?.let { put("previousAssetFingerprint", it) }
            anchorReason?.let { put("reason", it) }
        })
        put("provenance", JSONObject().apply {
            put("source", "epub-reader")
            put("platform", platform)
            put("toolkitVersion", toolkitVersion)
        })
    }

    companion object {
        fun fromJson(value: JSONObject?): ReaderAnnotationRecord? {
            if (value == null) return null
            val locator = Locator.fromJSON(value.optJSONObject("locator")) ?: return null
            val color = ReaderAnnotationColor.fromWire(value.optString("color")) ?: return null
            val anchor = value.optJSONObject("anchor") ?: return null
            val provenance = value.optJSONObject("provenance") ?: return null
            if (provenance.optString("source") != "epub-reader") return null
            val tags = value.optJSONArray("tags")?.let { array ->
                buildList<String> {
                    for (index in 0 until array.length()) {
                        val tag = array.optString(index)
                        if (!tag.isNullOrBlank()) add(tag)
                    }
                }
            } ?: return null
            return ReaderAnnotationRecord(
                id = value.optString("id").takeIf(String::isNotBlank) ?: return null,
                bookId = value.optString("bookId").takeIf(String::isNotBlank) ?: return null,
                editionId = value.optString("editionId").takeIf(String::isNotBlank) ?: return null,
                assetId = value.optString("assetId").takeIf(String::isNotBlank) ?: return null,
                assetFingerprint = value.optString("assetFingerprint").takeIf(String::isNotBlank) ?: return null,
                locator = locator,
                quote = value.optString("quote").takeIf(String::isNotBlank) ?: return null,
                prefix = value.optString("prefix"),
                suffix = value.optString("suffix"),
                chapter = value.optString("chapter").takeIf(String::isNotBlank),
                color = color,
                note = value.optString("note"),
                tags = tags,
                createdAt = value.optString("createdAt").takeIf(String::isNotBlank) ?: return null,
                updatedAt = value.optString("updatedAt").takeIf(String::isNotBlank) ?: return null,
                deletedAt = value.optString("deletedAt").takeIf(String::isNotBlank),
                anchorStatus = anchor.optString("status").takeIf(String::isNotBlank) ?: return null,
                previousAssetFingerprint = anchor.optString("previousAssetFingerprint").takeIf(String::isNotBlank),
                anchorReason = anchor.optString("reason").takeIf(String::isNotBlank),
                platform = provenance.optString("platform").takeIf(String::isNotBlank) ?: return null,
                toolkitVersion = provenance.optString("toolkitVersion").takeIf(String::isNotBlank) ?: return null,
            )
        }
    }
}

internal data class ReaderAnnotationState(
    val bookId: String,
    val editionId: String,
    val annotations: MutableList<ReaderAnnotationRecord>,
    var updatedAt: String,
) {
    companion object {
        fun fromJson(value: JSONObject?): ReaderAnnotationState? {
            if (value?.optInt("version") != 1) return null
            val bookId = value.optString("bookId").takeIf(String::isNotBlank) ?: return null
            val editionId = value.optString("editionId").takeIf(String::isNotBlank) ?: return null
            val updatedAt = value.optString("updatedAt").takeIf(String::isNotBlank) ?: return null
            val values = value.optJSONArray("annotations") ?: return null
            val annotations = buildList {
                for (index in 0 until values.length()) {
                    ReaderAnnotationRecord.fromJson(values.optJSONObject(index))?.let(::add)
                }
            }.toMutableList()
            return ReaderAnnotationState(bookId, editionId, annotations, updatedAt)
        }
    }
}

internal class ReaderAnnotationEditorDialog(
    private val activity: AppCompatActivity,
    private val palette: ReaderPalette,
    private val quote: String,
    private val annotation: ReaderAnnotationRecord?,
    private val needsReview: Boolean,
    private val onSave: (ReaderAnnotationColor, String, List<String>) -> Unit,
    private val onDelete: (() -> Unit)? = null,
) {
    fun show() {
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(12), dp(20), dp(24))
            setBackgroundColor(palette.page)
        }
        if (needsReview) {
            content.addView(body(
                "This EPUB revision changed the original range. Confirm only if this is the same passage; Wovenleaf never moves an ambiguous highlight silently.",
                palette.raised,
            ))
        }
        content.addView(label("PASSAGE"))
        content.addView(body("“$quote”", palette.raised))
        content.addView(label("COLOR"))
        val colors = RadioGroup(activity).apply {
            orientation = RadioGroup.HORIZONTAL
            contentDescription = "Highlight color"
        }
        ReaderAnnotationColor.entries.forEachIndexed { index, color ->
            colors.addView(RadioButton(activity).apply {
                id = ViewId.next()
                text = color.label
                tag = color
                setTextColor(palette.ink)
                isChecked = color == (annotation?.color ?: ReaderAnnotationColor.OCHRE)
            }, RadioGroup.LayoutParams(0, dp(48), 1f))
        }
        content.addView(colors)
        content.addView(label("NOTE"))
        val note = EditText(activity).apply {
            setText(annotation?.note.orEmpty())
            hint = "What do you want to remember?"
            minLines = 5
            maxLines = 14
            gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setTextColor(palette.ink)
            setHintTextColor(palette.secondaryInk)
            setBackgroundColor(palette.raised)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            contentDescription = "Passage note"
        }
        content.addView(note, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(150)))
        content.addView(label("TAGS"))
        val tags = EditText(activity).apply {
            setText(annotation?.tags?.joinToString(", ").orEmpty())
            hint = "Theme, character, revisit"
            isSingleLine = true
            setTextColor(palette.ink)
            setHintTextColor(palette.secondaryInk)
            setBackgroundColor(palette.raised)
            setPadding(dp(12), 0, dp(12), 0)
            contentDescription = "Tags, separated by commas"
        }
        content.addView(tags, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        content.addView(body(
            "Wovenleaf saves only the passage you selected, never hidden chapter text. Protected EPUBs remain unsupported.",
            Color.TRANSPARENT,
            small = true,
        ))
        if (annotation != null && onDelete != null) {
            content.addView(Button(activity).apply {
                text = "Delete annotation"
                isAllCaps = false
                setTextColor(Color.rgb(176, 45, 35))
                setBackgroundColor(Color.TRANSPARENT)
                setOnClickListener { onDelete.invoke() }
            })
        }

        val scroll = ScrollView(activity).apply { addView(content) }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(if (needsReview) "Review highlight" else if (annotation == null) "New highlight" else "Edit highlight")
            .setView(scroll)
            .setNegativeButton("Cancel", null)
            .setPositiveButton(if (needsReview) "Keep here" else "Save", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val selected = colors.findViewById<RadioButton>(colors.checkedRadioButtonId)?.tag as? ReaderAnnotationColor
                    ?: ReaderAnnotationColor.OCHRE
                onSave(selected, note.text.toString().take(50_000), normalizeTags(tags.text.toString()))
                dialog.dismiss()
            }
            if (annotation != null && onDelete != null) {
                content.getChildAt(content.childCount - 1).setOnClickListener {
                    dialog.dismiss()
                    onDelete.invoke()
                }
            }
        }
        dialog.show()
    }

    private fun label(value: String) = TextView(activity).apply {
        text = value
        textSize = 11f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(palette.secondaryInk)
        setPadding(0, dp(16), 0, dp(6))
    }

    private fun body(value: String, background: Int, small: Boolean = false) = TextView(activity).apply {
        text = value
        textSize = if (small) 12f else 15f
        typeface = if (small) Typeface.DEFAULT else Typeface.create("serif", Typeface.NORMAL)
        setTextColor(if (small) palette.secondaryInk else palette.ink)
        setBackgroundColor(background)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }

    private fun normalizeTags(raw: String): List<String> {
        val seen = mutableSetOf<String>()
        return raw.split(',')
            .map { it.trim().replace(Regex("\\s+"), " ") }
            .filter { it.isNotEmpty() && it.length <= 64 && seen.add(it.lowercase()) }
            .sortedWith(String.CASE_INSENSITIVE_ORDER)
            .take(32)
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()
}

private object ViewId {
    fun next(): Int = android.view.View.generateViewId()
}
