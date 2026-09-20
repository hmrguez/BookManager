package com.hmrguez.wovenleaf;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WovenleafLibby")
public final class WovenleafLibbyPlugin extends Plugin {
    @Override public void load() { LibbyConnection.changed = () -> notifyListeners("captureReceived", new JSObject()); }
    @Override protected void handleOnDestroy() { LibbyConnection.changed = null; }
    private void start() { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), LibbyConnectionService.class)); }
    @PluginMethod public void configure(PluginCall call) {
        try {
            boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
            LibbyConnection.configure(getContext(), enabled);
            if (!enabled) getContext().stopService(new Intent(getContext(), LibbyConnectionService.class));
            else if (LibbyConnection.paired() && !LibbyConnection.paused(getContext()) && !LibbyConnectionService.running && LibbyConnection.error == null) start();
            call.resolve();
        } catch (Exception e) { call.reject("The Libby connection could not be configured."); }
    }
    @PluginMethod public void beginPairing(PluginCall call) {
        try { String code = LibbyConnection.beginPairing(getContext()); LibbyConnection.error = null; start(); call.resolve(new JSObject().put("code", code)); }
        catch (Exception e) { call.reject("Could not start the connection. Open Wovenleaf and try again."); }
    }
    @PluginMethod public void resume(PluginCall call) {
        try { LibbyConnection.error = null; LibbyConnection.pause(getContext(), false); start(); call.resolve(); }
        catch (Exception e) { call.reject("Could not resume the local connection."); }
    }
    @PluginMethod public void copyCode(PluginCall call) {
        try { LibbyConnection.copyCode(getContext()); call.resolve(); }
        catch (Exception e) { call.reject("The code expired. Start a new connection."); }
    }
    @PluginMethod public void status(PluginCall call) {
        JSObject value = new JSObject().put("running", LibbyConnectionService.running).put("paired", LibbyConnection.paired()).put("pairing", LibbyConnection.pairing());
        if (LibbyConnection.error != null) value.put("error", LibbyConnection.error);
        call.resolve(value);
    }
    @PluginMethod public void pending(PluginCall call) {
        try { call.resolve(new JSObject().put("snapshots", LibbyConnection.pending(getContext()))); }
        catch (Exception e) { call.reject("A saved capture could not be read. Reconnect Libby to clear it."); }
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        try { LibbyConnection.acknowledge(getContext(), call.getArray("ids", new JSArray())); call.resolve(); }
        catch (Exception e) { call.reject("The capture could not be acknowledged. It is safe to retry."); }
    }
}
