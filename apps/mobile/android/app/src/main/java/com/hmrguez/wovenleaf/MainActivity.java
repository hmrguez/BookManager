package com.hmrguez.wovenleaf;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        normalizeSharedBookIntent(getIntent());
        registerPlugin(WovenleafFeedbackPlugin.class);
        registerPlugin(WovenleafReaderPlugin.class);
        registerPlugin(WovenleafPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        normalizeSharedBookIntent(intent);
        super.onNewIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void normalizeSharedBookIntent(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || intent.getData() != null) return;

        Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream != null) intent.setData(stream);
    }
}
