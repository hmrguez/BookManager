import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let appGroupId = "group.com.hmrguez.wovenleaf"
    private let storageKey = "share-target-data"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        Task { await captureSharedContent() }
    }

    private func captureSharedContent() async {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            finish()
            return
        }

        var texts: [String] = []
        var files: [[String: String]] = []
        for provider in item.attachments ?? [] {
            if let file = await copySharedCSV(from: provider) {
                files.append(file)
            } else if let value = await loadText(from: provider), !value.isEmpty {
                texts.append(value)
            }
        }

        guard !texts.isEmpty || !files.isEmpty else {
            finish()
            return
        }

        let payload: [String: Any] = [
            "title": item.attributedTitle?.string ?? "",
            "texts": texts,
            "files": files,
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

    private func copySharedCSV(from provider: NSItemProvider) async -> [String: String]? {
        let suggestedName = provider.suggestedName ?? "goodreads-library.csv"
        let hasCSVName = suggestedName.lowercased().hasSuffix(".csv")
        let csvType = UTType.commaSeparatedText.identifier
        guard provider.hasItemConformingToTypeIdentifier(csvType) || hasCSVName else { return nil }

        let type = provider.hasItemConformingToTypeIdentifier(csvType)
            ? csvType
            : UTType.data.identifier
        guard provider.hasItemConformingToTypeIdentifier(type) else { return nil }

        return await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { [appGroupId] sourceURL, _ in
                guard let sourceURL,
                      let groupURL = FileManager.default.containerURL(
                        forSecurityApplicationGroupIdentifier: appGroupId
                      ) else {
                    continuation.resume(returning: nil)
                    return
                }
                do {
                    let incoming = groupURL.appendingPathComponent("IncomingShares", isDirectory: true)
                    try FileManager.default.createDirectory(
                        at: incoming,
                        withIntermediateDirectories: true
                    )
                    let safeName = self.safeFilename(suggestedName)
                    let destination = incoming.appendingPathComponent(
                        "\(UUID().uuidString)-\(safeName)"
                    )
                    try FileManager.default.copyItem(at: sourceURL, to: destination)
                    continuation.resume(returning: [
                        "uri": destination.path,
                        "name": safeName,
                        "mimeType": UTType(type)?.preferredMIMEType ?? "text/csv",
                    ])
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func safeFilename(_ value: String) -> String {
        let name = URL(fileURLWithPath: value).lastPathComponent
        let cleaned = name.replacingOccurrences(
            of: "[^A-Za-z0-9._ -]",
            with: "-",
            options: .regularExpression
        )
        return cleaned.lowercased().hasSuffix(".csv")
            ? cleaned
            : "\(cleaned).csv"
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
