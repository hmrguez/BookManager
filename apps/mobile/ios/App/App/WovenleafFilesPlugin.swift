import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

@objc(WovenleafFilesPlugin)
final class WovenleafFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "WovenleafFilesPlugin"
    let jsName = "WovenleafFiles"
    let pluginMethods = ["pick", "register", "stat", "read", "reconcile", "incoming"].compactMap {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var pickerCall: CAPPluginCall?
    private static weak var current: WovenleafFilesPlugin?
    private static var pending: [[String: Any]] = []

    override func load() { Self.current = self }

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { call.reject("A file picker is already open."); return }
            self.pickerCall = call
            let types: [UTType] = call.getBool("folder") == true ? [.folder]
                : call.getString("kind") == "audio" ? [.audio, .image, .json, UTType(filenameExtension: "m4b") ?? .audio, UTType(filenameExtension: "cue") ?? .plainText]
                : [.pdf, UTType(filenameExtension: "epub") ?? .data]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.allowsMultipleSelection = call.getBool("folder") != true
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["files": []]); pickerCall = nil
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }
        pickerCall = nil
        // Acquire picker grants before returning from its callback.
        let scopes = urls.map { OriginalFileAccess(url: $0, scope: $0) }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                var files: [[String: Any]] = []
                for access in scopes {
                    if call.getBool("folder") == true {
                        try access.coordinated { root in
                            let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
                            while let file = enumerator?.nextObject() as? URL {
                                let suffix = file.pathExtension.lowercased()
                                let supported = call.getString("kind") == "audio"
                                    ? ["mp3", "m4b", "m4a", "mp4", "cue", "json", "jpg", "jpeg", "png", "gif", "webp", "avif"]
                                    : ["epub", "pdf"]
                                if supported.contains(suffix) { files.append(try WovenleafFileReferences.register(file, scope: root)) }
                            }
                        }
                    } else { files.append(try WovenleafFileReferences.register(access.url)) }
                }
                call.resolve(["files": files])
            } catch { Self.reject(call, error) }
        }
    }

    @objc func register(_ call: CAPPluginCall) {
        work(call) { try WovenleafFileReferences.selection(call.getString("uri") ?? "") }
    }

    @objc func stat(_ call: CAPPluginCall) {
        work(call) {
            let access = try WovenleafFileReferences.acquire("wovenleaf-file://" + (call.getString("id") ?? ""))
            let size = try access.coordinated { try $0.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0 }
            var result: [String: Any] = ["size": size]
            if let expectedSize = call.getInt("byteSize"), expectedSize != size { throw WovenleafFileReferences.unavailable("FILE_CHANGED") }
            if call.getString("fingerprint") != nil || call.getBool("hash") == true {
                let actual = try access.fingerprint()
                if let expected = call.getString("fingerprint"), expected != actual { throw WovenleafFileReferences.unavailable("FILE_CHANGED") }
                result["fingerprint"] = actual
            }
            return result
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        work(call) {
            let access = try WovenleafFileReferences.acquire("wovenleaf-file://" + (call.getString("id") ?? ""))
            let offset = call.getInt("offset") ?? -1
            let length = call.getInt("length") ?? 0
            guard offset >= 0, length > 0, length <= 1024 * 1024 else { throw WovenleafFileReferences.unavailable("FILE_UNSUPPORTED") }
            return try access.coordinated { file in
                let handle = try FileHandle(forReadingFrom: file)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                return ["data": (try handle.read(upToCount: length) ?? Data()).base64EncodedString()]
            }
        }
    }

    @objc func reconcile(_ call: CAPPluginCall) {
        let ids = Set(call.getArray("ids", String.self) ?? [])
        // A grace period protects open pickers/reviews and extension-to-host handoffs.
        let cutoff = Date().timeIntervalSince1970 - 86400
        for (key, value) in WovenleafFileReferences.defaults.dictionaryRepresentation() where key.hasPrefix(WovenleafFileReferences.prefix) {
            let id = String(key.dropFirst(WovenleafFileReferences.prefix.count))
            guard !ids.contains(id), !WovenleafFileReferences.isActive(id),
                  let record = value as? [String: Any], let created = record["created"] as? Double, created < cutoff else { continue }
            WovenleafFileReferences.defaults.removeObject(forKey: key)
        }
        call.resolve()
    }

    @objc func incoming(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let files = Self.pending
            Self.pending = []
            call.resolve(["files": files])
        }
    }

    static func receive(_ url: URL) -> Bool {
        guard url.isFileURL else { return false }
        let suffix = url.pathExtension.lowercased()
        guard ["epub", "pdf", "mp3", "m4b", "m4a", "mp4"].contains(suffix) else { return false }
        var item: [String: Any] = ["name": url.lastPathComponent, "kind": ["epub", "pdf"].contains(suffix) ? "ebook" : "audio"]
        do {
            let file = try WovenleafFileReferences.register(url)
            item["uri"] = "wovenleaf-file://" + (file["id"] as! String)
        } catch { item["needsSelection"] = true }
        pending.append(item)
        current?.notifyListeners("incoming", data: [:])
        return true
    }

    private func work(_ call: CAPPluginCall, action: @escaping () throws -> [String: Any]) {
        DispatchQueue.global(qos: .userInitiated).async {
            do { call.resolve(try action()) } catch { Self.reject(call, error) }
        }
    }

    private static func reject(_ call: CAPPluginCall, _ error: Error) {
        let code = (error as? OriginalFileError)?.code ?? ((error as NSError).code == NSFileReadNoPermissionError ? "FILE_PERMISSION" : "FILE_MISSING")
        call.reject("The original file could not be opened. Choose it again.", code, error)
    }
}
