package com.hmrguez.wovenleaf

import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.util.Locale

object WovenleafL10n {
    private var app: Context? = null
    var languageChanged: (() -> Unit)? = null
    private val catalogs = mutableMapOf<String, JSONObject>()
    fun initialize(context: Context) { app = context.applicationContext }
    fun setLocale(locale: String) {
        app?.getSharedPreferences("wovenleaf.localization", Context.MODE_PRIVATE)?.edit()
            ?.putString("interfaceLocale", locale)?.apply()
        languageChanged?.invoke()
    }
    fun locale(): Locale = Locale.forLanguageTag(app?.getSharedPreferences("wovenleaf.localization", Context.MODE_PRIVATE)?.getString("interfaceLocale", null) ?: Locale.getDefault().toLanguageTag())
    @Synchronized
    fun text(source: String, parameters: Map<String, String> = emptyMap()): String {
        val context = app ?: return source
        val locale = context.getSharedPreferences("wovenleaf.localization", Context.MODE_PRIVATE)
            .getString("interfaceLocale", null) ?: Locale.getDefault().toLanguageTag()
        val language = locale.substringBefore('-').lowercase().takeIf { it in listOf("en", "es", "de", "it", "fr") } ?: "en"
        val catalog = catalogs.getOrPut(language) {
            try { context.assets.open("public/locales/$language.json").bufferedReader().use { JSONObject(it.readText()) } }
            catch (_: Exception) { JSONObject() }
        }
        var result = catalog.optString(source, source)
        parameters.forEach { (name, value) -> result = result.replace("{{$name}}", value) }
        return result
    }
}

@CapacitorPlugin(name = "WovenleafLocalization")
class WovenleafLocalizationPlugin : Plugin() {
    override fun load() { WovenleafL10n.initialize(context) }
    @PluginMethod
    fun setLocale(call: PluginCall) {
        val locale = call.getString("locale")
        if (locale !in listOf("en-US", "es-ES", "de-DE", "it-IT", "fr-FR")) {
            call.reject("Unsupported interface locale", "INVALID_LOCALE")
            return
        }
        WovenleafL10n.setLocale(requireNotNull(locale))
        call.resolve()
    }
}
