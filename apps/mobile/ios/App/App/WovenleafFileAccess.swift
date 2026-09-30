import Foundation
import CryptoKit
import UniformTypeIdentifiers

struct OriginalFileError: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// Shared by the host and share extension. Each reference is independent so an
/// extension write cannot replace a registry snapshot held by the host process.
enum WovenleafFileReferences {
    static let defaults = UserDefaults(suiteName: "group.com.hmrguez.wovenleaf")!
    static let prefix = "original-file.v1."
    private static let lock = NSLock()
    private static var leases: [String: Int] = [:]
    static func retain(_ id: String) { lock.lock(); defer { lock.unlock() }; leases[id, default: 0] += 1 }
    static func release(_ id: String) { lock.lock(); defer { lock.unlock() }; leases[id, default: 1] -= 1; if leases[id] == 0 { leases.removeValue(forKey: id) } }
    static func isActive(_ id: String) -> Bool { lock.lock(); defer { lock.unlock() }; return leases[id, default: 0] > 0 }


    static func register(_ url: URL, scope: URL? = nil) throws -> [String: Any] {
        guard url.isFileURL, !url.path.contains("/tmp/"), !url.path.contains("/Inbox/"),
              !url.path.contains("/IncomingShares/") else {
            throw OriginalFileError(code: "RESELECT_FILE", message: WovenleafL10n.text("Choose the original in Files."))
        }
        let root = scope ?? url
        let access = OriginalFileAccess(url: url, scope: root)
        return try access.coordinated { file in
            let values = try file.resourceValues(forKeys: [.fileSizeKey, .nameKey, .contentTypeKey, .isRegularFileKey])
            guard values.isRegularFile == true, let size = values.fileSize else {
                throw OriginalFileError(code: "FILE_UNSUPPORTED", message: WovenleafL10n.text("Choose a readable file."))
            }
            let id = SHA256.hash(data: Data(file.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
            let name = values.name ?? file.lastPathComponent
            // iOS embeds the document-picker scope in the bookmark; the macOS
            // withSecurityScope creation option is unavailable on iOS.
            let bookmark = try root.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let relative = scope == nil ? "" : String(file.path.dropFirst(root.path.count + 1))
            let record: [String: Any] = ["bookmark": bookmark, "relative": relative, "name": name,
                "created": Date().timeIntervalSince1970]
            defaults.set(record, forKey: prefix + id)
            return ["id": id, "name": name, "size": size,
                "mediaType": values.contentType?.preferredMIMEType ?? "application/octet-stream",
                "relativePath": relative.isEmpty ? name : relative]
        }
    }

    static func acquire(_ uri: String) throws -> OriginalFileAccess {
        guard let url = URL(string: uri) else { throw unavailable() }
        if url.scheme == "wovenleaf-file" {
            guard let id = url.host, let record = defaults.dictionary(forKey: prefix + id),
                  let data = record["bookmark"] as? Data else { throw unavailable("FILE_PERMISSION") }
            var stale = false
            let root: URL
            do { root = try URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale) }
            catch {
                let code = (error as NSError).code
                throw unavailable(code == NSFileNoSuchFileError || code == NSFileReadNoSuchFileError ? "FILE_MISSING" : "FILE_PERMISSION")
            }
            let relative = record["relative"] as? String ?? ""
            guard !relative.split(separator: "/").contains("..") else { throw unavailable() }
            let file = relative.isEmpty ? root : root.appendingPathComponent(relative)
            let access = OriginalFileAccess(url: file, scope: root, referenceId: id)
            if stale {
                var refreshed = record
                refreshed["bookmark"] = try root.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                defaults.set(refreshed, forKey: prefix + id)
            }
            try access.check()
            return access
        }
        // Legacy managed assets still use the same restricted private root.
        guard url.isFileURL,
              let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { throw unavailable() }
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        let root = library.appendingPathComponent("NoCloud").standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else { throw unavailable("FILE_PERMISSION") }
        let access = OriginalFileAccess(url: file)
        try access.check()
        return access
    }

    static func selection(_ uri: String) throws -> [String: Any] {
        guard let id = URL(string: uri)?.host, uri.hasPrefix("wovenleaf-file://") else {
            throw unavailable("RESELECT_FILE")
        }
        let access = try acquire(uri)
        return try access.coordinated { url in
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .nameKey, .contentTypeKey])
            return ["id": id, "name": values.name ?? url.lastPathComponent,
                "size": values.fileSize ?? 0, "mediaType": values.contentType?.preferredMIMEType ?? "application/octet-stream"]
        }
    }

    static func unavailable(_ code: String = "FILE_MISSING") -> OriginalFileError {
        OriginalFileError(code: code, message: WovenleafL10n.text("The original file is unavailable. Choose it again; progress and notes are safe."))
    }
}

/// Owns the security scope and file-presenter lifetime for asynchronous engine reads.
final class OriginalFileAccess: NSObject, NSFilePresenter {
    let url: URL
    private let scope: URL?
    private let scoped: Bool
    private let referenceId: String?
    var presentedItemURL: URL? { url }
    let presentedItemOperationQueue = OperationQueue()

    init(url: URL, scope: URL? = nil, referenceId: String? = nil) {
        self.url = url
        self.referenceId = referenceId
        self.scope = scope
        scoped = scope?.startAccessingSecurityScopedResource() ?? false
        super.init()
        if let referenceId { WovenleafFileReferences.retain(referenceId) }
        presentedItemOperationQueue.maxConcurrentOperationCount = 1
        NSFileCoordinator.addFilePresenter(self)
    }

    deinit {
        NSFileCoordinator.removeFilePresenter(self)
        if scoped { scope?.stopAccessingSecurityScopedResource() }
        if let referenceId { WovenleafFileReferences.release(referenceId) }
    }

    func check() throws {
        let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        if let status = values?.ubiquitousItemDownloadingStatus, status == .notDownloaded {
            throw WovenleafFileReferences.unavailable("FILE_OFFLINE")
        }
        guard FileManager.default.fileExists(atPath: url.path) else { throw WovenleafFileReferences.unavailable() }
        guard FileManager.default.isReadableFile(atPath: url.path) else { throw WovenleafFileReferences.unavailable("FILE_PERMISSION") }
    }

    func coordinated<T>(_ action: (URL) throws -> T) throws -> T {
        var result: Result<T, Error>?
        var error: NSError?
        NSFileCoordinator(filePresenter: self).coordinate(readingItemAt: url, options: [], error: &error) { file in
            result = Result { try action(file) }
        }
        if let result { return try result.get() }
        throw error ?? WovenleafFileReferences.unavailable() as NSError
    }

    func fingerprint() throws -> String {
        try coordinated { file in
            let handle = try FileHandle(forReadingFrom: file)
            defer { try? handle.close() }
            var hash = SHA256()
            while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
            return hash.finalize().map { String(format: "%02x", $0) }.joined()
        }
    }
}

// Interface language is independent of a publication's language and TTS voice.
enum WovenleafL10n {
    private static let defaults = UserDefaults(suiteName: "group.com.hmrguez.wovenleaf") ?? .standard
    private static let storageKey = "wovenleaf.interfaceLocale.v1"
    private static var catalogs: [String: [String: String]] = [:]
    private static let lock = NSLock()
    static var locale: String {
        defaults.string(forKey: storageKey) ?? Locale.preferredLanguages.first ?? "en-US"
    }
    static func setLocale(_ value: String) {
        defaults.set(value, forKey: storageKey)
        NotificationCenter.default.post(name: .init("WovenleafInterfaceLanguageChanged"), object: nil)
    }
    static func text(_ source: String, _ parameters: [String: String] = [:]) -> String {
        lock.lock()
        defer { lock.unlock() }
        let candidate = locale.lowercased().split(separator: "-").first.map(String.init) ?? "en"
        let language = ["en", "es", "de", "it", "fr"].contains(candidate) ? candidate : "en"
        if catalogs[language] == nil {
            let host = Bundle.main.bundleURL.pathExtension == "appex" ? Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()) : Bundle.main
            let url = host?.url(forResource: language, withExtension: "json", subdirectory: "public/locales")
            catalogs[language] = url.flatMap { try? Data(contentsOf: $0) }
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
        }
        var result = catalogs[language]?[source] ?? source
        for (name, value) in parameters { result = result.replacingOccurrences(of: "{{" + name + "}}", with: value) }
        return result
    }
}
