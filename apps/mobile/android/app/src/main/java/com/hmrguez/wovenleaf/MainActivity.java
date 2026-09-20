package com.hmrguez.wovenleaf;

import android.os.Bundle;
import android.content.Intent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (WovenleafFilesPlugin.receive(this, getIntent())) setIntent(new Intent(this, MainActivity.class));
        registerPlugin(WovenleafFilesPlugin.class);
        registerPlugin(WovenleafFeedbackPlugin.class);
        registerPlugin(WovenleafPurchasesPlugin.class);
        registerPlugin(WovenleafReaderPlugin.class);
        registerPlugin(WovenleafPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (WovenleafFilesPlugin.receive(this, intent)) {
            super.onNewIntent(new Intent(this, MainActivity.class));
            return;
        }
        super.onNewIntent(intent);
    }
}
