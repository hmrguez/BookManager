package com.hmrguez.wovenleaf;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "WovenleafWidgets")
public class WovenleafWidgetsPlugin extends Plugin {
    @PluginMethod public void publish(PluginCall call) {
        String snapshot = call.getString("snapshot");
        try {
            JSONObject value = new JSONObject(snapshot == null ? "{}" : snapshot);
            if (value.getInt("version") != 1) throw new IllegalArgumentException("Unsupported snapshot");
            var preferences = getContext().getSharedPreferences("reading-widgets", 0);
            if (!snapshot.equals(preferences.getString("snapshot", ""))) {
                if (!preferences.edit().putString("snapshot", snapshot).commit()) throw new IllegalStateException("Could not save widgets");
                ReadingWidgetProvider.refreshAll(getContext());
            }
            call.resolve();
        } catch (Exception error) { call.reject("Could not publish reading widgets", error); }
    }
}
