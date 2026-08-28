import Capacitor
import Foundation
import ReadiumNavigator
import ReadiumShared
import ReadiumStreamer
import UIKit

final class WovenleafBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WovenleafReaderPlugin())
    }
}

@objc(WovenleafReaderPlugin)
final class WovenleafReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafReaderPlugin"
    let jsName = "WovenleafReader"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainOutbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
    ]

    private let readium = WovenleafReadium()
    private static weak var current: WovenleafReaderPlugin?

    override func load() {
        Self.current = self
    }

    @objc func open(_ call: CAPPluginCall) {
        guard
            let bookId = call.getString("bookId"),
            let editionId = call.getString("editionId"),
            let assetId = call.getString("assetId"),
            let fingerprint = call.getString("assetFingerprint"),
            let title = call.getString("title"),
            let fileURI = call.getString("fileUri"),
            let fileURL = URL(string: fileURI),
            let validatedURL = validateManagedURL(fileURL),
            let globalPreferences = WovenleafReaderPreferences(object: call.getObject("globalPreferences"))
        else {
            call.reject("The reader capability is invalid.", "INVALID_CAPABILITY")
            return
        }
        guard FileManager.default.fileExists(atPath: validatedURL.path) else {
            call.reject("The managed EPUB file is missing.", "MISSING_ASSET")
            return
        }

        let context = ReaderContext(
            bookId: bookId,
            editionId: editionId,
            assetId: assetId,
            assetFingerprint: fingerprint,
            title: title
        )
        let initialLocator = call.getObject("initialLocator").flatMap(locator(from:))
        let bookPreferences = WovenleafReaderPreferences(object: call.getObject("bookPreferences"))

        Task { @MainActor in
            do {
                guard let presenter = bridge?.viewController else {
                    call.reject("The reader host is unavailable.", "OPEN_FAILED")
                    return
                }
                guard let readiumURL = FileURL(url: validatedURL) else {
                    call.reject("The managed EPUB URL is invalid.", "INVALID_CAPABILITY")
                    return
                }
                let asset = try await readium.assetRetriever.retrieve(url: readiumURL).get()
                let publication = try await readium.publicationOpener.open(
                    asset: asset,
                    allowUserInteraction: false,
                    sender: presenter
                ).get()
                guard !publication.isRestricted else {
                    publication.close()
                    call.reject("Protected publications are not supported.", "CORRUPT_ASSET")
                    return
                }
                let reader = try WovenleafReaderViewController(
                    publication: publication,
                    initialLocator: initialLocator,
                    context: context,
                    globalPreferences: globalPreferences,
                    bookPreferences: bookPreferences
                )
                let navigation = UINavigationController(rootViewController: reader)
                navigation.modalPresentationStyle = .fullScreen
                presenter.present(navigation, animated: true)
                call.resolve()
            } catch {
                call.reject("Readium could not open this EPUB.", "CORRUPT_ASSET", error)
            }
        }
    }

    @objc func drainOutbox(_ call: CAPPluginCall) {
        call.resolve(["events": ReaderOutbox.events])
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        let ids = Set(call.getArray("ids", String.self) ?? [])
        ReaderOutbox.acknowledge(ids: ids)
        call.resolve()
    }

    fileprivate static func emit(_ event: [String: Any]) {
        current?.notifyListeners("readerEvent", data: event, retainUntilConsumed: true)
    }

    private func locator(from object: JSObject) -> Locator? {
        guard
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            let string = String(data: data, encoding: .utf8),
            let json = try? JSONValue(jsonString: string)
        else { return nil }
        return try? Locator(json: json, warnings: nil)
    }

    private func validateManagedURL(_ url: URL) -> URL? {
        guard url.isFileURL else { return nil }
        let candidate = url.standardizedFileURL.resolvingSymlinksInPath()
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            return nil
        }
        let root = library.appendingPathComponent("NoCloud", isDirectory: true)
            .standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(root.path + "/") else { return nil }
        return candidate
    }
}

private final class WovenleafReadium {
    let httpClient: HTTPClient = DefaultHTTPClient()
    lazy var assetRetriever = AssetRetriever(httpClient: httpClient)
    lazy var publicationOpener = PublicationOpener(
        parser: DefaultPublicationParser(
            httpClient: httpClient,
            assetRetriever: assetRetriever,
            pdfFactory: DefaultPDFDocumentFactory()
        )
    )
}

struct ReaderContext {
    let bookId: String
    let editionId: String
    let assetId: String
    let assetFingerprint: String
    let title: String
}

enum ReaderOutbox {
    private static let eventsKey = "wovenleaf.reader.outbox.v1"
    private static let sequencePrefix = "wovenleaf.reader.sequence."

    static var events: [[String: Any]] {
        UserDefaults.standard.array(forKey: eventsKey) as? [[String: Any]] ?? []
    }

    @discardableResult
    static func enqueue(
        kind: String,
        context: ReaderContext,
        sessionId: String,
        locator: Locator?,
        startedAt: String? = nil,
        endedAt: String? = nil,
        activeDurationMs: Int? = nil,
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        let defaults = UserDefaults.standard
        let sequenceKey = sequencePrefix + context.assetId
        let sequence = defaults.integer(forKey: sequenceKey) + 1
        defaults.set(sequence, forKey: sequenceKey)
        var event: [String: Any] = [
            "id": "reading-event:reader:\(UUID().uuidString.lowercased())",
            "sequence": sequence,
            "kind": kind,
            "bookId": context.bookId,
            "editionId": context.editionId,
            "assetId": context.assetId,
            "assetFingerprint": context.assetFingerprint,
            "sessionId": sessionId,
            "emittedAt": Self.timestamp(),
            "platform": "ios",
            "toolkitVersion": "3.11.0",
        ]
        if let locator { event["locator"] = locator.jsonObject.mapValues(\.any) }
        if let startedAt { event["startedAt"] = startedAt }
        if let endedAt { event["endedAt"] = endedAt }
        if let activeDurationMs { event["activeDurationMs"] = activeDurationMs }
        extra.forEach { event[$0.key] = $0.value }
        var pending = events
        pending.append(event)
        defaults.set(pending, forKey: eventsKey)
        WovenleafReaderPlugin.emit(event)
        return event
    }

    static func acknowledge(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        UserDefaults.standard.set(
            events.filter { event in
                guard let id = event["id"] as? String else { return true }
                return !ids.contains(id)
            },
            forKey: eventsKey
        )
    }

    static func enqueuePreference(
        context: ReaderContext,
        sessionId: String,
        scope: ReaderPreferenceScope,
        preferences: WovenleafReaderPreferences?
    ) {
        var extra: [String: Any] = ["preferenceScope": scope.rawValue]
        extra["preferences"] = preferences?.object ?? NSNull()
        enqueue(
            kind: "preference",
            context: context,
            sessionId: sessionId,
            locator: nil,
            extra: extra
        )
    }

    static func timestamp(_ date: Date = Date()) -> String {
        ISO8601DateFormatter.reader.string(from: date)
    }
}

private extension ISO8601DateFormatter {
    static let reader: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
