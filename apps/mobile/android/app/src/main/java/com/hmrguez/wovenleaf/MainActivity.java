package com.hmrguez.wovenleaf;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        normalizeSharedBookIntent(getIntent());
        super.onCreate(savedInstanceState);

        // The library, reading history, and notes are private throughout the current app.
        // Keep them out of screenshots, screen recordings, non-secure displays, and Recents.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
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
