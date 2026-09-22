package com.hmrguez.wovenleaf;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Locale;

public class ReadingWidgetProvider extends AppWidgetProvider {
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> type : new Class<?>[]{ReadingWidgetProvider.class, StreakWidgetProvider.class}) {
            for (int id : manager.getAppWidgetIds(new ComponentName(context, type))) render(context, manager, id, type == StreakWidgetProvider.class);
        }
    }
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id, this instanceof StreakWidgetProvider);
    }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id, this instanceof StreakWidgetProvider);
    }
    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if ("com.hmrguez.wovenleaf.WIDGET_BOOK".equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            if (id < 0) return;
            var prefs = context.getSharedPreferences("reading-widgets", 0);
            int index = prefs.getInt("index-" + id, 0) + intent.getIntExtra("direction", 1);
            prefs.edit().putInt("index-" + id, index).apply();
            render(context, AppWidgetManager.getInstance(context), id, false);
        }
    }
    @Override public void onDeleted(Context context, int[] ids) {
        var editor = context.getSharedPreferences("reading-widgets", 0).edit();
        for (int id : ids) { editor.remove("index-" + id); editor.remove("latest-" + id); }
        editor.apply();
    }
    private static PendingIntent open(Context context, int id, String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static PendingIntent switchBook(Context context, int id, int direction) {
        Intent intent = new Intent(context, ReadingWidgetProvider.class).setAction("com.hmrguez.wovenleaf.WIDGET_BOOK");
        intent.setData(Uri.parse("wovenleaf://widget-switch/" + id + "/" + direction));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("direction", direction);
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void render(Context context, AppWidgetManager manager, int id, boolean streak) {
        var prefs = context.getSharedPreferences("reading-widgets", 0);
        JSONObject snapshot;
        try { snapshot = new JSONObject(prefs.getString("snapshot", "{}")); }
        catch (Exception error) { snapshot = new JSONObject(); }
        RemoteViews view = new RemoteViews(context.getPackageName(), streak ? R.layout.widget_streak : R.layout.widget_reading);
        if (streak) {
            HashSet<String> days = new HashSet<>();
            JSONArray recorded = snapshot.optJSONArray("days");
            if (recorded != null) for (int i = 0; i < recorded.length(); i++) days.add(recorded.optString(i));
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
            Calendar cursor = Calendar.getInstance();
            boolean today = days.contains(format.format(cursor.getTime()));
            if (!today) cursor.add(Calendar.DATE, -1);
            int count = 0;
            while (days.contains(format.format(cursor.getTime()))) { count++; cursor.add(Calendar.DATE, -1); }
            view.setTextViewText(R.id.widget_count, String.valueOf(count));
            view.setTextViewText(R.id.widget_unit, count == 1 ? "day of reading" : "days of reading");
            view.setTextViewText(R.id.widget_status, today ? "Read today ✓" : count > 0 ? "Keep it going today" : "Every page is a beginning");
            view.setOnClickPendingIntent(R.id.widget_root, open(context, id, "wovenleaf://widgets/streak"));
        } else {
            JSONArray books = snapshot.optJSONArray("books");
            int length = books == null ? 0 : books.length();
            String latest = length > 0 ? books.optJSONObject(0).optString("id") + books.optJSONObject(0).optString("lastActivity") : "";
            int index = latest.equals(prefs.getString("latest-" + id, "")) ? prefs.getInt("index-" + id, 0) : 0;
            index = length == 0 ? 0 : Math.floorMod(index, length);
            prefs.edit().putInt("index-" + id, index).putString("latest-" + id, latest).apply();
            JSONObject book = length > 0 ? books.optJSONObject(index) : new JSONObject();
            try {
                byte[] cover = android.util.Base64.decode(book.optString("cover"), android.util.Base64.DEFAULT);
                android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(cover, 0, cover.length);
                if (bitmap != null) view.setImageViewBitmap(R.id.widget_cover, bitmap);
            } catch (IllegalArgumentException ignored) { }
            String title = book.optString("title", "Your next page awaits");
            view.setTextViewText(R.id.widget_title, title);
            view.setTextViewText(R.id.widget_author, book.optString("author", "Start a book in Wovenleaf"));
            view.setTextViewText(R.id.widget_progress, book.optString("progressLabel", "Open library"));
            view.setTextViewText(R.id.widget_position, length > 1 ? (index + 1) + " / " + length : "Reading");
            view.setProgressBar(R.id.widget_meter, 100, book.optInt("progress", 0), false);
            view.setViewVisibility(R.id.widget_previous, length > 1 ? View.VISIBLE : View.GONE);
            view.setViewVisibility(R.id.widget_next, length > 1 ? View.VISIBLE : View.GONE);
            view.setOnClickPendingIntent(R.id.widget_previous, switchBook(context, id, -1));
            view.setOnClickPendingIntent(R.id.widget_next, switchBook(context, id, 1));
            view.setOnClickPendingIntent(R.id.widget_root, open(context, id, book.optString("url", "wovenleaf://widgets/reading")));
            view.setOnClickPendingIntent(R.id.widget_progress, open(context, id, book.optString("url", "wovenleaf://widgets/reading")));
        }
        manager.updateAppWidget(id, view);
    }
}
