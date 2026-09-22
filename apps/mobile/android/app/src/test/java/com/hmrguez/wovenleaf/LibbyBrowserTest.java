package com.hmrguez.wovenleaf;

import static org.junit.Assert.*;
import org.junit.Test;

public class LibbyBrowserTest {
    @Test public void routesFirefoxPairingToFirefox() {
        assertEquals("org.mozilla.firefox", LibbyBrowser.preferredPackage(
            "moz-extension://01234567-89ab-cdef-0123-456789abcdef"));
    }

    @Test public void routesChromiumPairingToQuetta() {
        assertEquals("net.quetta.browser", LibbyBrowser.preferredPackage(
            "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    }

    @Test public void doesNotPreferQuettaWithoutRecognizedPairing() {
        for (String origin : new String[] { null, "", "https://libbyapp.com", "moz-extension://invalid", "chrome-extension://invalid" }) {
            assertNull(LibbyBrowser.preferredPackage(origin));
        }
    }
}
