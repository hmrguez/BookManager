import Foundation
import CryptoKit

/// Fixed-purpose, non-expiring review grant. The private signing key never ships.
enum ReviewAccessVerifier {
    static func verify(_ token: String, publicKeyDER: String) -> Bool {
        guard token.range(of: "\\AWLR1\\.[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil,
              let keyData = Data(base64Encoded: publicKeyDER.trimmingCharacters(in: .whitespacesAndNewlines))
        else { return false }
        var encoded = String(token.dropFirst(5)).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let signatureData = Data(base64Encoded: encoded),
              let key = try? P256.Signing.PublicKey(derRepresentation: keyData),
              let signature = try? P256.Signing.ECDSASignature(derRepresentation: signatureData)
        else { return false }
        return key.isValidSignature(signature, for: Data("WLR1:com.hmrguez.wovenleaf:review:unlimited".utf8))
    }
}
