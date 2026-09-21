package com.hmrguez.wovenleaf;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

/** Exercises production boundaries without changing the user's pairing, inbox or books. */
@RunWith(AndroidJUnit4.class)
public class LibbyConnectionTest {
    @Test public void acceptsFirefoxOriginsWithoutWeakeningOriginBinding() throws Exception {
        String origin = "moz-extension://01234567-89ab-cdef-0123-456789abcdef";
        assertTrue(LibbyConnection.extensionOrigin(origin));
        for (String invalid : new String[] { origin + "/", origin + ":43187", origin + "@evil.example", "moz-extension://libby@wovenleaf.app", "null", "http://127.0.0.1", "moz-extension://not-a-uuid" })
            assertFalse(LibbyConnection.extensionOrigin(invalid));
        SecretKey key = new SecretKeySpec(new byte[32], "AES");
        String aad = LibbyConnection.aad("/v1/capture", origin, false);
        JSONObject sealed = LibbyConnection.seal(key, snapshot().toString(), aad);
        LibbyConnection.validate(LibbyConnection.open(key, sealed, aad));
        rejects(() -> LibbyConnection.open(key, sealed, LibbyConnection.aad("/v1/capture", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false)));
        rejects(() -> LibbyConnection.open(key, sealed, aad.replace("01234567", "11234567")));
    }
    private JSONObject snapshot() throws Exception {
        return new JSONObject().put("kind", "wovenleaf-libby").put("version", 1).put("id", UUID.randomUUID().toString())
            .put("capturedAt", Instant.now().toString()).put("observations", new JSONArray().put(new JSONObject()
                .put("titleId", "123").put("title", "Fixture loan").put("author", "Test Author").put("format", "audiobook").put("percent", 10)));
    }
    private interface Checked { void run() throws Exception; }
    private void rejects(Checked action) { try { action.run(); fail("Untrusted input was accepted"); } catch (Exception expected) { } }
    @Test public void authenticatesOriginRouteDirectionAndCiphertext() throws Exception {
        SecretKey key = new SecretKeySpec(new byte[32], "AES");
        String origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        String aad = LibbyConnection.aad("/v1/capture", origin, false);
        JSONObject sealed = LibbyConnection.seal(key, snapshot().toString(), aad);
        assertEquals(10, LibbyConnection.validate(LibbyConnection.open(key, sealed, aad)).getJSONArray("observations").getJSONObject(0).getInt("percent"));
        rejects(() -> LibbyConnection.open(key, sealed, LibbyConnection.aad("/v1/pair", origin, false)));
        rejects(() -> LibbyConnection.open(key, sealed, LibbyConnection.aad("/v1/capture", origin, true)));
        rejects(() -> LibbyConnection.open(key, sealed, aad.replace("aaaa", "bbbb")));
        rejects(() -> LibbyConnection.open(new SecretKeySpec(new byte[16], "AES"), sealed, aad));
        rejects(() -> LibbyConnection.open(key, new JSONObject(sealed.toString()).put("extra", true), aad));
        byte[] data = android.util.Base64.decode(sealed.getString("data"), android.util.Base64.NO_WRAP); data[0] ^= 1;
        rejects(() -> LibbyConnection.open(key, new JSONObject(sealed.toString()).put("data", android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP)), aad));
        assertTrue(LibbyConnection.extensionOrigin(origin));
        assertFalse(LibbyConnection.extensionOrigin("https://libbyapp.com"));
        assertFalse(LibbyConnection.extensionOrigin(origin + "/popup.html"));
    }
    @Test public void rejectsPrivateFieldsInvalidPercentagesDuplicatesAndOversize() throws Exception {
        JSONObject covered = snapshot();
        covered.getJSONArray("observations").getJSONObject(0).put("coverUrl", "https://img1.od-cdn.com/ImageType-400/1234-1/{ABC-123}IMG400.JPG");
        LibbyConnection.validate(covered.toString());
        for (String url : new String[] { "https://evil.example/cover.jpg", "http://img1.od-cdn.com/ImageType-400/a.jpg", "https://img1.od-cdn.com/ImageType-400/a.jpg?token=secret", "https://img1.od-cdn.com@evil.example/ImageType-400/a.jpg" }) {
            covered.getJSONArray("observations").getJSONObject(0).put("coverUrl", url);
            rejects(() -> LibbyConnection.validate(covered.toString()));
        }
        rejects(() -> LibbyConnection.validate(snapshot().put("token", "fixture-only").toString()));
        rejects(() -> LibbyConnection.validate(snapshot().put("id", "../../outside").toString()));
        rejects(() -> LibbyConnection.validate(snapshot().put("capturedAt", Instant.now().plusSeconds(600).toString()).toString()));
        for (Object invalid : new Object[] { true, "10", -1, 101 }) {
            JSONObject value = snapshot(); value.getJSONArray("observations").getJSONObject(0).put("percent", invalid);
            rejects(() -> LibbyConnection.validate(value.toString()));
        }
        JSONObject duplicate = snapshot(); duplicate.getJSONArray("observations").put(duplicate.getJSONArray("observations").getJSONObject(0));
        rejects(() -> LibbyConnection.validate(duplicate.toString()));
        JSONObject privateField = snapshot(); privateField.getJSONArray("observations").getJSONObject(0).put("text", "Never accept book contents");
        rejects(() -> LibbyConnection.validate(privateField.toString()));
        rejects(() -> LibbyConnection.validate(" ".repeat(131073)));
        assertEquals(1, LibbyConnection.validate(snapshot().toString()).getJSONArray("observations").length());
    }
}
