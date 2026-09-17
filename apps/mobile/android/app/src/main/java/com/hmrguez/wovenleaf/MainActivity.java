package com.hmrguez.wovenleaf;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WovenleafFeedbackPlugin.class);
        registerPlugin(WovenleafPurchasesPlugin.class);
        registerPlugin(WovenleafReaderPlugin.class);
        registerPlugin(WovenleafPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }

}
