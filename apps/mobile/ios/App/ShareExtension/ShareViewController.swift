import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroupId = "group.com.hmrguez.wovenleaf"
    private let storageKey = "share-target-data"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        Task { await captureSharedText() }
    }

    private func captureSharedText() async {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            finish()
            return
        }

        var texts: [String] = []
        for provider in item.attachments ?? [] {
            if let value = await loadText(from: provider), !value.isEmpty {
                texts.append(value)
            }
        }

        guard !texts.isEmpty else {
            finish()
            return
        }

        let payload: [String: Any] = [
            "title": item.attributedTitle?.string ?? "",
            "texts": texts,
            "files": [[String: Any]](),
        ]
        let defaults = UserDefaults(suiteName: appGroupId)
        defaults?.set(payload, forKey: storageKey)
        defaults?.synchronize()

        guard let url = URL(string: "wovenleaf://share") else {
            finish()
            return
        }
        _ = await extensionContext?.open(url)
        finish()
    }

    private func loadText(from provider: NSItemProvider) async -> String? {
        let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
            ? UTType.url.identifier
            : UTType.plainText.identifier
        guard provider.hasItemConformingToTypeIdentifier(type) else { return nil }

        return await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                if let url = item as? URL {
                    continuation.resume(returning: url.absoluteString)
                } else if let text = item as? String {
                    continuation.resume(returning: text)
                } else if let text = item as? NSAttributedString {
                    continuation.resume(returning: text.string)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
