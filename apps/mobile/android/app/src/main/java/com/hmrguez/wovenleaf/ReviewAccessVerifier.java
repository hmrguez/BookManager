package com.hmrguez.wovenleaf;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/** Fixed-purpose, non-expiring review grant. No caller-supplied claims or algorithms. */
public final class ReviewAccessVerifier {
    private static final String MESSAGE = "WLR1:com.hmrguez.wovenleaf:review:unlimited";

    public static boolean verify(String token, String publicKeyDer) {
        try {
            if (token == null || !token.matches("WLR1\\.[A-Za-z0-9_-]{1,128}")) return false;
            var key = KeyFactory.getInstance("EC").generatePublic(
                new X509EncodedKeySpec(Base64.getDecoder().decode(publicKeyDer.trim())));
            var verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(key);
            verifier.update(MESSAGE.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(Base64.getUrlDecoder().decode(token.substring(5)));
        } catch (Exception ignored) {
            return false;
        }
    }

    private ReviewAccessVerifier() {}
}
