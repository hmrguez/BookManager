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
            if let file = await copySharedDocument(from: provider) {
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

    private func copySharedDocument(from provider: NSItemProvider) async -> [String: String]? {
        let supported = [UTType.pdf.identifier, "org.idpf.epub-container", UTType.mp3.identifier, UTType.mpeg4Audio.identifier, UTType.commaSeparatedText.identifier]
        let detectedType = supported.first { provider.hasItemConformingToTypeIdentifier($0) }
        let defaultName = detectedType == UTType.pdf.identifier ? "Shared book.pdf"
            : detectedType == "org.idpf.epub-container" ? "Shared book.epub"
            : detectedType == UTType.mp3.identifier ? "Shared audiobook.mp3"
            : detectedType == UTType.mpeg4Audio.identifier ? "Shared audiobook.m4b"
            : "goodreads-library.csv"
        let suggestedName = provider.suggestedName ?? defaultName
        let suffix = (suggestedName as NSString).pathExtension.lowercased()
        guard detectedType != nil || ["csv", "epub", "pdf", "mp3", "m4b", "m4a", "mp4"].contains(suffix) else { return nil }
        let type = detectedType ?? UTType.data.identifier
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
                    let extensionName = UTType(type)?.preferredFilenameExtension ?? suffix
                    let safeName = self.safeFilename(suggestedName, extensionName: extensionName)
                    let destination = incoming.appendingPathComponent(
                        "\(UUID().uuidString)-\(safeName)"
                    )
                    try FileManager.default.copyItem(at: sourceURL, to: destination)
                    continuation.resume(returning: [
                        "uri": destination.absoluteString,
                        "name": safeName,
                        "mimeType": UTType(type)?.preferredMIMEType ?? "text/csv",
                    ])
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private func safeFilename(_ value: String, extensionName: String) -> String {
        let name = URL(fileURLWithPath: value).lastPathComponent
        let cleaned = name.replacingOccurrences(
            of: "[^A-Za-z0-9._ -]",
            with: "-",
            options: .regularExpression
        )
        return cleaned.lowercased().hasSuffix(".\(extensionName)")
            ? cleaned
            : "\(cleaned).\(extensionName)"
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
