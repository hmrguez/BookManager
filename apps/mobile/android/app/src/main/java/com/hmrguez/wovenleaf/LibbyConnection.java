package com.hmrguez.wovenleaf;

import android.content.Context;
import android.security.keystore.KeyProtection;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Same-device encrypted inbox. No provider credentials, raw payload logs or remote listener. */
final class LibbyConnection {
    static final int PORT = 43187;
    static final int MAX_WIRE = 180000;
    private static final String ALIAS = "wovenleaf.libby.connection.v1";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static SecretKey pairingKey;
    private static long pairingUntil;
    private static int attempts;
    static volatile Runnable changed;
    static volatile String error;
    private static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("libby-connection", Context.MODE_PRIVATE); }
    static boolean enabled(Context c) { return prefs(c).getBoolean("enabled", false); }
    static boolean paused(Context c) { return prefs(c).getBoolean("paused", false); }
    static void pause(Context c, boolean paused) { prefs(c).edit().putBoolean("paused", paused).commit(); signal(); }
    static void signal() { Runnable listener = changed; if (listener != null) listener.run(); }
    private static KeyStore vault() throws Exception { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return store; }
    private static SecretKey key() throws Exception { return (SecretKey) vault().getKey(ALIAS, null); }
    static synchronized boolean paired() { try { return key() != null; } catch (Exception e) { return false; } }
    static synchronized String pairedOrigin(Context c) {
        return enabled(c) && paired() ? prefs(c).getString("origin", null) : null;
    }
    static synchronized boolean pairing() {
        if (android.os.SystemClock.elapsedRealtime() >= pairingUntil) pairingKey = null;
        return pairingKey != null;
    }
    static synchronized void copyCode(Context c) throws Exception {
        if (!pairing()) throw new IOException();
        StringBuilder code = new StringBuilder(); for (byte b : pairingKey.getEncoded()) code.append(String.format(Locale.ROOT, "%02x", b & 255));
        android.content.ClipData clip = android.content.ClipData.newPlainText("Wovenleaf connection code", code.toString());
        android.os.PersistableBundle extras = new android.os.PersistableBundle(); extras.putBoolean("android.content.extra.IS_SENSITIVE", true); clip.getDescription().setExtras(extras);
        android.content.ClipboardManager clipboard = c.getSystemService(android.content.ClipboardManager.class); clipboard.setPrimaryClip(clip);
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            try {
                android.content.ClipData current = clipboard.getPrimaryClip();
                if (current != null && current.getItemCount() == 1 && code.toString().contentEquals(current.getItemAt(0).coerceToText(c))) {
                    if (android.os.Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip();
                    else clipboard.setPrimaryClip(android.content.ClipData.newPlainText("", ""));
                }
            } catch (SecurityException ignored) { /* Android may deny clipboard access in the background. */ }
        }, 300000);
    }
    static synchronized void configure(Context c, boolean enabled) throws Exception {
        prefs(c).edit().putBoolean("enabled", enabled).commit();
        if (!enabled) {
            pairingKey = null; pairingUntil = 0;
            vault().deleteEntry(ALIAS);
            prefs(c).edit().remove("origin").remove("paused").commit();
            for (File file : files(c)) new AtomicFile(file).delete();
        }
    }
    static synchronized String beginPairing(Context c) throws Exception {
        if (!enabled(c)) throw new IOException("Enable Libby first.");
        byte[] bytes = new byte[16]; RANDOM.nextBytes(bytes);
        pairingKey = new SecretKeySpec(bytes, "AES");
        pairingUntil = android.os.SystemClock.elapsedRealtime() + 300000; attempts = 0;
        pause(c, false);
        StringBuilder code = new StringBuilder(); for (byte b : bytes) code.append(String.format(Locale.ROOT, "%02x", b & 255));
        return code.toString();
    }
    static boolean extensionOrigin(String origin) { return origin != null && (origin.matches("chrome-extension://[a-p]{32}") || origin.matches("moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")); }
    static String aad(String route, String origin, boolean response) { return "wovenleaf-libby/v1" + route + "|" + origin + (response ? "|response" : "|request"); }
    static JSONObject seal(SecretKey secret, String text, String aad) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secret);
        cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("data", Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
    }
    static String open(SecretKey secret, JSONObject envelope, String aad) throws Exception {
        if (secret == null || envelope.length() != 2) throw new IOException();
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] data = Base64.decode(envelope.getString("data"), Base64.NO_WRAP);
        if (iv.length != 12 || data.length > 131088) throw new IOException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, secret, new GCMParameterSpec(128, iv));
        cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(data), StandardCharsets.UTF_8);
    }
    static synchronized JSONObject request(Context c, String route, String origin, String body) throws Exception {
        if (!enabled(c) || paused(c) || !extensionOrigin(origin)) throw new IOException();
        if (route.equals("/v1/pair")) {
            if (!pairing() || ++attempts > 5) { pairingKey = null; throw new IOException(); }
            SecretKey bootstrap = pairingKey;
            JSONObject input = new JSONObject(open(bootstrap, new JSONObject(body), aad(route, origin, false)));
            String challenge = input.getString("challenge");
            if (input.length() != 1 || !uuid(challenge)) throw new IOException();
            byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes);
            SecretKey next = new SecretKeySpec(bytes, "AES");
            JSONObject response = seal(bootstrap, new JSONObject().put("challenge", challenge).put("key", Base64.encodeToString(bytes, Base64.NO_WRAP)).toString(), aad(route, origin, true));
            vault().setEntry(ALIAS, new KeyStore.SecretKeyEntry(next), new KeyProtection.Builder(KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            prefs(c).edit().putString("origin", origin).commit();
            pairingKey = null; pairingUntil = 0; signal();
            return response;
        }
        if (!route.equals("/v1/capture") || !origin.equals(prefs(c).getString("origin", ""))) throw new IOException();
        SecretKey secret = key();
        String text = open(secret, new JSONObject(body), aad(route, origin, false));
        JSONObject snapshot = validate(text);
        File destination = new File(directory(c), snapshot.getString("id") + ".json");
        if (!destination.exists() && files(c).size() >= 20) return seal(secret, new JSONObject().put("id", snapshot.getString("id")).put("ok", false).put("message", "Open Wovenleaf to receive saved captures, then return to your shelf.").toString(), aad(route, origin, true));
        AtomicFile file = new AtomicFile(destination); FileOutputStream stream = null;
        try { stream = file.startWrite(); stream.write(text.getBytes(StandardCharsets.UTF_8)); file.finishWrite(stream); }
        catch (Exception e) { if (stream != null) file.failWrite(stream); throw e; }
        signal();
        return seal(secret, new JSONObject().put("id", snapshot.getString("id")).put("ok", true).toString(), aad(route, origin, true));
    }
    static boolean uuid(String id) { return id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"); }
    static boolean validCover(String value) {
        return value.length() <= 2048 && value.matches("(?i)^https://(?:img[1-9][0-9]*\\.od-cdn\\.com|images\\.contentreserve\\.com)/ImageType-[0-9]+/[a-z0-9%_./~{}-]+\\.(?:jpe?g|png|webp)$");
    }
    static JSONObject validate(String text) throws Exception {
        if (text.getBytes(StandardCharsets.UTF_8).length > 131072) throw new IOException();
        JSONObject value = new JSONObject(text);
        if (value.length() != 5 || !value.getString("kind").equals("wovenleaf-libby") || !(value.get("version") instanceof Number) || value.getDouble("version") != 1 || !uuid(value.getString("id"))) throw new IOException();
        String at = value.getString("capturedAt");
        if (!at.endsWith("Z") || Instant.parse(at).isAfter(Instant.now().plusSeconds(300))) throw new IOException();
        JSONArray observations = value.getJSONArray("observations");
        if (observations.length() < 1 || observations.length() > 100) throw new IOException();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < observations.length(); i++) {
            JSONObject item = observations.getJSONObject(i);
            if (item.length() != (item.has("coverUrl") ? 6 : 5) || (item.has("coverUrl") && (!(item.get("coverUrl") instanceof String) || !validCover(item.getString("coverUrl")))) || !(item.get("titleId") instanceof String) || !item.getString("titleId").matches("[0-9]{1,20}") || !Set.of("ebook", "audiobook").contains(item.getString("format")) || !(item.get("title") instanceof String) || item.getString("title").trim().isEmpty() || item.getString("title").length() > 500 || !(item.get("author") instanceof String) || item.getString("author").length() > 500 || !(item.get("percent") instanceof Number)) throw new IOException();
            double percent = item.getDouble("percent");
            if (!Double.isFinite(percent) || percent < 0 || percent > 100 || !seen.add(item.getString("format") + ":" + item.getString("titleId"))) throw new IOException();
        }
        return value;
    }
    private static File directory(Context c) throws IOException { File dir = new File(c.getNoBackupFilesDir(), "libby-inbox"); if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException(); return dir; }
    private static List<File> files(Context c) throws IOException { File[] files = directory(c).listFiles((dir, name) -> name.endsWith(".json")); if (files == null) throw new IOException(); return Arrays.asList(files); }
    static synchronized JSONArray pending(Context c) throws Exception {
        List<JSONObject> values = new ArrayList<>();
        if (enabled(c)) for (File file : files(c)) {
            byte[] bytes = new AtomicFile(file).readFully(); if (bytes.length > 131072) throw new IOException();
            String text = new String(bytes, StandardCharsets.UTF_8); JSONObject snapshot = validate(text);
            values.add(new JSONObject().put("id", snapshot.getString("id")).put("text", text).put("at", snapshot.getString("capturedAt")));
        }
        values.sort(Comparator.comparing(value -> Instant.parse(value.optString("at"))));
        JSONArray result = new JSONArray(); for (JSONObject value : values) { value.remove("at"); result.put(value); } return result;
    }
    static synchronized void acknowledge(Context c, JSONArray ids) throws Exception { for (int i = 0; i < ids.length(); i++) { String id = ids.getString(i); if (!uuid(id)) throw new IOException(); new AtomicFile(new File(directory(c), id + ".json")).delete(); } }
}
