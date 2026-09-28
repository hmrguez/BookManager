import Capacitor
import UIKit
import UniformTypeIdentifiers

@objc(WovenleafSnapshotPlugin)
final class WovenleafSnapshotPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "WovenleafSnapshotPlugin"
    let jsName = "WovenleafSnapshot"
    let pluginMethods = ["exportImage", "clearCache"].compactMap { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private var pending: CAPPluginCall?
    private var temporary: URL?

    @objc func clearCache(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil else { call.reject("Close the export sheet before erasing private data."); return }
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("wovenleaf-snapshots")
                if FileManager.default.fileExists(atPath: folder.path) { try FileManager.default.removeItem(at: folder) }
                call.resolve()
            } catch { call.reject("Could not clear temporary images. Please retry.") }
        }
    }

    @objc func exportImage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil, let controller = self.bridge?.viewController,
                  controller.presentedViewController == nil else { call.reject("Close the current sheet and retry."); return }
            guard let raw = call.getString("png"), raw.count <= 16_000_000,
                  let bytes = Data(base64Encoded: raw), bytes.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
                  let image = UIImage(data: bytes), let pixels = image.cgImage,
                  pixels.width == 1080, [1080, 1920].contains(pixels.height),
                  let action = call.getString("action"), ["save", "share"].contains(action) else {
                call.reject("The image could not be prepared."); return
            }
            do {
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("wovenleaf-snapshots", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                // Clean leftovers from a terminated export before staging another explicit export.
                for file in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) { try FileManager.default.removeItem(at: file) }
                let file = folder.appendingPathComponent("wovenleaf-reading-quarter.png")
                try bytes.write(to: file, options: [.atomic, .completeFileProtection])
                self.temporary = file; self.pending = call
                if action == "save" {
                    let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
                    picker.delegate = self
                    controller.present(picker, animated: true)
                } else {
                    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                    sheet.popoverPresentationController?.sourceView = controller.view
                    sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                    sheet.completionWithItemsHandler = { _, completed, _, error in
                        if error != nil { self.finish(error: true) }
                        else { self.finish(status: completed ? "shared" : "cancelled") }
                    }
                    controller.present(sheet, animated: true)
                }
            } catch {
                if self.pending != nil { self.finish(error: true) }
                else { call.reject("The image could not be saved. Please retry.") }
            }
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(status: "cancelled") }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(status: urls.isEmpty ? "cancelled" : "saved")
    }
    private func finish(status: String = "cancelled", error: Bool = false) {
        let call = pending; pending = nil
        if let file = temporary { try? FileManager.default.removeItem(at: file) }; temporary = nil
        if error { call?.reject("The image could not be exported. Please retry.") }
        else { call?.resolve(["status": status]) }
    }
}
