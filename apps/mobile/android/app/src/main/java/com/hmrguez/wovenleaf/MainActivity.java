package com.hmrguez.wovenleaf;

import android.os.Bundle;
import android.content.Intent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        setIntent(routeLibbyFile(getIntent()));
        if (WovenleafFilesPlugin.receive(this, getIntent())) setIntent(new Intent(this, MainActivity.class));
        registerPlugin(WovenleafFilesPlugin.class);
        registerPlugin(WovenleafFeedbackPlugin.class);
        registerPlugin(WovenleafPurchasesPlugin.class);
        registerPlugin(WovenleafReaderPlugin.class);
        registerPlugin(WovenleafPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // JSON document providers often expose opaque content URIs. Preserve the grant
    // and use the existing share-target intake, which carries the filename and MIME.
    private Intent routeLibbyFile(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return intent;
        String type = intent.getType();
        if (type == null) {
            try { type = getContentResolver().getType(intent.getData()); }
            catch (SecurityException ignored) { return intent; }
        }
        if (!"application/json".equals(type)) return intent;
        Intent shared = new Intent(intent).setAction(Intent.ACTION_SEND);
        shared.putExtra(Intent.EXTRA_STREAM, intent.getData());
        shared.setDataAndType(null, "application/json");
        return shared;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        intent = routeLibbyFile(intent);
        if (WovenleafFilesPlugin.receive(this, intent)) {
            super.onNewIntent(new Intent(this, MainActivity.class));
            return;
        }
        super.onNewIntent(intent);
    }
}
