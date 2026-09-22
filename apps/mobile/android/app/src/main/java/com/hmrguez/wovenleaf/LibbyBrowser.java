package com.hmrguez.wovenleaf;

import android.content.Intent;
import android.content.ComponentName;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import java.util.ArrayList;

/** Keep the Shelf in a browser where the progress companion can run. */
final class LibbyBrowser {
    private static final Uri SHELF = Uri.parse("https://libbyapp.com/shelf");

    static Intent quetta() {
        return new Intent(Intent.ACTION_VIEW, SHELF)
            .addCategory(Intent.CATEGORY_BROWSABLE).setPackage("net.quetta.browser");
    }

    static Intent fallback(PackageManager packages) {
        Intent view = new Intent(Intent.ACTION_VIEW, SHELF).addCategory(Intent.CATEGORY_BROWSABLE);
        ArrayList<Intent> browsers = new ArrayList<>();
        for (ResolveInfo handler : packages.queryIntentActivities(view, PackageManager.MATCH_ALL | PackageManager.GET_RESOLVED_FILTER)) {
            // Domain-specific handlers (including Libby) must never enter the chooser.
            if (handler.filter != null && handler.filter.countDataAuthorities() == 0 && handler.activityInfo.exported) {
                browsers.add(new Intent(view).setComponent(new ComponentName(
                    handler.activityInfo.packageName, handler.activityInfo.name)));
            }
        }
        if (browsers.isEmpty()) throw new ActivityNotFoundException("No browser installed");
        Intent first = browsers.remove(0);
        return browsers.isEmpty() ? first : Intent.createChooser(first, "Open Libby in browser")
            .putExtra(Intent.EXTRA_INITIAL_INTENTS, browsers.toArray(new Intent[0]));
    }
}
