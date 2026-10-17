import Capacitor
import Foundation
import ReadiumNavigator
import ReadiumShared
import ReadiumStreamer
import UIKit
import PDFKit

final class WovenleafBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WovenleafLocalizationPlugin())
        bridge?.registerPluginInstance(WovenleafFeedbackPlugin())
        bridge?.registerPluginInstance(WovenleafReviewAccessibilityPlugin())
        bridge?.registerPluginInstance(WovenleafSnapshotPlugin())
        bridge?.registerPluginInstance(WovenleafReaderPlugin())
        bridge?.registerPluginInstance(WovenleafFilesPlugin())
        bridge?.registerPluginInstance(WovenleafLibbyPlugin())
        bridge?.registerPluginInstance(WovenleafPlaybackPlugin())
    }
}

@objc(WovenleafReaderPlugin)
final class WovenleafReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafReaderPlugin"
    let jsName = "WovenleafReader"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pdfCover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeForIncomingFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainOutbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
    ]

    private let readium = WovenleafReadium()
    private static weak var current: WovenleafReaderPlugin?

    override func load() {
        Self.current = self
    }

    @objc func closeForIncomingFile(_ call: CAPPluginCall) {
        Task { @MainActor in
            let presented = bridge?.viewController?.presentedViewController
            if let navigation = presented as? UINavigationController,
               let reader = navigation.viewControllers.first as? WovenleafReaderViewController {
                reader.closeForIncomingFile { call.resolve() }
            } else if let pdf = presented as? WovenleafPDFViewController {
                // viewWillDisappear checkpoints and ends the PDF reading session.
                pdf.dismiss(animated: false) { call.resolve() }
            } else {
                call.resolve()
            }
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        if let locale = call.getString("interfaceLocale") { WovenleafL10n.setLocale(locale) }
        guard
            let bookId = call.getString("bookId"),
            let editionId = call.getString("editionId"),
            let assetId = call.getString("assetId"),
            let fingerprint = call.getString("assetFingerprint"),
            let title = call.getString("title"),
            let fileURI = call.getString("fileUri"),
            let globalPreferences = WovenleafReaderPreferences(object: call.getObject("globalPreferences")),
            let navigationState = ReaderNavigationState(object: call.getObject("navigationState")),
            let annotationState = ReaderAnnotationCollection(object: call.getObject("annotationState"))
        else {
            call.reject(WovenleafL10n.text("The reader capability is invalid."), "INVALID_CAPABILITY")
            return
        }

        let context = ReaderContext(
            bookId: bookId,
            editionId: editionId,
            assetId: assetId,
            assetFingerprint: fingerprint,
            title: title,
            compatibility: ReaderPublicationProfile(object: call.getObject("compatibility")),
            navigationState: navigationState,
            annotationState: annotationState
        )
        let initialLocator = call.getObject("initialLocator").flatMap(readerLocator(from:))
        let bookPreferences = WovenleafReaderPreferences(object: call.getObject("bookPreferences"))

        Task { @MainActor in
            do {
                let access = try WovenleafFileReferences.acquire(fileURI)
                let validatedURL = access.url
                if fileURI.hasPrefix("wovenleaf-file://"), try access.fingerprint() != fingerprint {
                    throw WovenleafFileReferences.unavailable("FILE_CHANGED")
                }
                guard let presenter = bridge?.viewController else {
                    call.reject(WovenleafL10n.text("The reader host is unavailable."), "OPEN_FAILED")
                    return
                }
                if call.getString("format") == "pdf" {
                    let reader = try WovenleafPDFViewController(url: validatedURL, context: context, initialLocator: call.getObject("initialLocator"))
                    reader.fileAccess = access
                    reader.modalPresentationStyle = .fullScreen
                    presenter.present(reader, animated: true)
                    call.resolve()
                    return
                }
                guard let readiumURL = FileURL(url: validatedURL) else {
                    call.reject(WovenleafL10n.text("The book URL is invalid."), "INVALID_CAPABILITY")
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
                    call.reject(WovenleafL10n.text("Protected publications are not supported."), "CORRUPT_ASSET")
                    return
                }
                let reader = try WovenleafReaderViewController(
                    publication: publication,
                    initialLocator: initialLocator,
                    context: context,
                    globalPreferences: globalPreferences,
                    bookPreferences: bookPreferences
                )
                reader.fileAccess = access
                let navigation = UINavigationController(rootViewController: reader)
                navigation.modalPresentationStyle = .fullScreen
                presenter.present(navigation, animated: true)
                call.resolve()
            } catch {
                call.reject(WovenleafL10n.text("The reader could not open this book."), (error as? OriginalFileError)?.code ?? "CORRUPT_ASSET", error)
            }
        }
    }

    @objc func pdfCover(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let access = try WovenleafFileReferences.acquire(call.getString("fileUri") ?? "")
                let jpeg = try access.coordinated { file -> Data in
                    guard let document = PDFDocument(url: file), !document.isEncrypted,
                          let page = document.page(at: 0),
                          let jpeg = page.thumbnail(of: CGSize(width: 480, height: 640), for: .cropBox).jpegData(compressionQuality: 0.82) else {
                        throw WovenleafFileReferences.unavailable("CORRUPT_ASSET")
                    }
                    return jpeg
                }
                call.resolve(["jpeg": jpeg.base64EncodedString()])
            } catch { call.reject(WovenleafL10n.text("This PDF could not be rendered."), (error as? OriginalFileError)?.code ?? "CORRUPT_ASSET", error) }
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
    let compatibility: ReaderPublicationProfile?
    let navigationState: ReaderNavigationState
    let annotationState: ReaderAnnotationCollection
}

struct ReaderPublicationProfile {
    let layout: String
    let pageProgressionDirection: String
    let primaryLanguage: String
    let notices: [String]
    let verticalWriting: Bool

    init?(object: [String: Any]?) {
        guard
            let object,
            object["version"] as? Int == 1,
            let layout = object["layout"] as? String,
            let direction = object["pageProgressionDirection"] as? String,
            let language = object["primaryLanguage"] as? String,
            let features = object["features"] as? [String: Any],
            let support = object["support"] as? [String: Any]
        else { return nil }
        self.layout = layout
        pageProgressionDirection = direction
        primaryLanguage = language
        notices = support["notices"] as? [String] ?? []
        verticalWriting = features["verticalWriting"] as? Bool ?? false
    }

    var isRightToLeft: Bool { pageProgressionDirection == "rtl" }

    func renderingPreferences(_ source: WovenleafReaderPreferences) -> WovenleafReaderPreferences {
        var result = source
        if layout == "fixed-layout" || layout == "mixed" {
            result.layout = .paginated
            result.columnCount = .one
            result.publisherStyles = true
        }
        if verticalWriting {
            result.layout = .paginated
            result.columnCount = .one
            result.textAlign = .start
            result.publisherStyles = true
        }
        return result
    }
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

    static func enqueueBookmark(
        context: ReaderContext,
        sessionId: String,
        action: String,
        bookmarkId: String,
        locator: Locator? = nil,
        createdAt: String? = nil
    ) {
        var extra: [String: Any] = [
            "action": action,
            "bookmarkId": bookmarkId,
        ]
        if let createdAt { extra["createdAt"] = createdAt }
        enqueue(
            kind: "bookmark",
            context: context,
            sessionId: sessionId,
            locator: locator,
            extra: extra
        )
    }

    static func enqueueToc(context: ReaderContext, sessionId: String, locator: Locator?) {
        enqueue(
            kind: "toc",
            context: context,
            sessionId: sessionId,
            locator: locator,
            extra: locator == nil ? ["locator": NSNull()] : [:]
        )
    }

    static func enqueueAnnotation(
        context: ReaderContext,
        sessionId: String,
        action: String,
        annotationId: String,
        annotation: ReaderAnnotationRecord? = nil
    ) {
        var extra: [String: Any] = [
            "action": action,
            "annotationId": annotationId,
        ]
        if let annotation { extra["annotation"] = annotation.object }
        enqueue(
            kind: "annotation",
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

@objc(WovenleafLocalizationPlugin)
final class WovenleafLocalizationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafLocalizationPlugin"
    let jsName = "WovenleafLocalization"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setLocale", returnType: CAPPluginReturnPromise)]
    @objc func setLocale(_ call: CAPPluginCall) {
        guard let locale = call.getString("locale"), ["en-US", "es-ES", "de-DE", "it-IT", "fr-FR"].contains(locale) else {
            call.reject("Unsupported interface locale", "INVALID_LOCALE")
            return
        }
        DispatchQueue.main.async { WovenleafL10n.setLocale(locale); call.resolve() }
    }
}
