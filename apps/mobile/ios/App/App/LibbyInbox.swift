import Foundation
import CoreFoundation
import Darwin

/// Shared only by Wovenleaf and its Safari extension. Files are atomically written under a cross-process lock.
enum LibbyInbox {
    private static let group = "group.com.hmrguez.wovenleaf"
    private static let enabledKey = "wovenleaf-libby-enabled"
    private static let limit = 128 * 1024
    private static func failure(_ message: String) -> NSError { NSError(domain: "WovenleafLibby", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

    private static func locked<T>(_ work: (URL, UserDefaults) throws -> T) throws -> T {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let defaults = UserDefaults(suiteName: group) else { throw failure("Libby storage is unavailable. Check the app group signing configuration.") }
        var directory = container.appendingPathComponent("LibbyInbox", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        let descriptor = open(directory.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw failure("Libby storage could not be opened.") }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw failure("Libby storage is busy. Try again.") }
        defer { flock(descriptor, LOCK_UN) }
        defaults.synchronize()
        return try work(directory, defaults)
    }

    static func configure(enabled: Bool) throws {
        try locked { directory, defaults in
            defaults.set(enabled, forKey: enabledKey); defaults.synchronize()
            if !enabled { for file in try files(directory) { try FileManager.default.removeItem(at: file) } }
        }
    }

    static func receive(_ value: Any) throws {
        let data = try validate(value)
        let object = value as! [String: Any]
        let id = (object["id"] as! String).lowercased()
        try locked { directory, defaults in
            guard defaults.bool(forKey: enabledKey) else { throw failure("Enable Libby progress in Wovenleaf Settings, then capture again.") }
            let destination = directory.appendingPathComponent(id + ".json")
            let existing = try files(directory)
            guard existing.count < 20 || FileManager.default.fileExists(atPath: destination.path) else { throw failure("Open Wovenleaf to receive your saved captures, then try again.") }
            try data.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func pending() throws -> [[String: String]] {
        try locked { directory, defaults in
            guard defaults.bool(forKey: enabledKey) else { return [] }
            return try files(directory).map { url in
                let data = try Data(contentsOf: url, options: [.mappedIfSafe])
                guard data.count <= limit, let text = String(data: data, encoding: .utf8) else { throw failure("A saved Libby capture could not be read. Disconnect Libby to clear it.") }
                return ["id": url.deletingPathExtension().lastPathComponent, "text": text]
            }.sorted { left, right in
                // ISO timestamps are validated before persistence; milliseconds are optional.
                let l = (try? JSONSerialization.jsonObject(with: Data(left["text"]!.utf8))) as? [String: Any]
                let r = (try? JSONSerialization.jsonObject(with: Data(right["text"]!.utf8))) as? [String: Any]
                return (date(l?["capturedAt"] as? String ?? "") ?? .distantPast) < (date(r?["capturedAt"] as? String ?? "") ?? .distantPast)
            }
        }
    }

    static func acknowledge(_ ids: [String]) throws {
        try locked { directory, _ in
            for id in ids {
                guard UUID(uuidString: id) != nil else { throw failure("Invalid capture identifier.") }
                let url = directory.appendingPathComponent(id.lowercased() + ".json")
                if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            }
        }
    }

    private static func files(_ directory: URL) throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }
    }
    private static func date(_ text: String) -> Date? {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = parser.date(from: text) { return value }
        parser.formatOptions = [.withInternetDateTime]; return parser.date(from: text)
    }
    static func validate(_ value: Any) throws -> Data {
        guard let object = value as? [String: Any], Set(object.keys) == Set(["kind", "version", "id", "capturedAt", "observations"]),
              object["kind"] as? String == "wovenleaf-libby", let version = object["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let id = object["id"] as? String, id.range(of: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", options: .regularExpression) != nil,
              let timestamp = object["capturedAt"] as? String, timestamp.hasSuffix("Z"), let captured = date(timestamp), captured.timeIntervalSinceNow <= 300,
              let observations = object["observations"] as? [[String: Any]], !observations.isEmpty, observations.count <= 100 else { throw failure("Unsupported Libby capture. Capture your shelf again.") }
        var keys = Set<String>()
        for item in observations {
            guard Set(item.keys) == Set(["titleId", "format", "title", "author", "percent"]),
                  let titleId = item["titleId"] as? String, titleId.range(of: "^[0-9]{1,20}$", options: .regularExpression) != nil,
                  let format = item["format"] as? String, ["ebook", "audiobook"].contains(format),
                  let title = item["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.utf16.count <= 500,
                  let author = item["author"] as? String, author.utf16.count <= 500,
                  let percent = item["percent"] as? NSNumber, CFGetTypeID(percent) != CFBooleanGetTypeID(), percent.doubleValue.isFinite, (0...100).contains(percent.doubleValue),
                  keys.insert(format + ":" + titleId).inserted else { throw failure("Unsupported Libby progress. Capture your shelf again.") }
        }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= limit else { throw failure("This capture is too large.") }
        return data
    }
}
