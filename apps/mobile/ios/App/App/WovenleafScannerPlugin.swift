import AVFoundation
import Capacitor
import UIKit

@objc(WovenleafScannerPlugin)
final class WovenleafScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafScannerPlugin"
    let jsName = "WovenleafScanner"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)]
    private var scanning = false

    @objc func scan(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.scanning else { call.reject("A scan is already in progress", "BUSY"); return }
            self.scanning = true
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        self.scanning = false
                        call.reject("Camera permission denied", "PERMISSION_DENIED")
                        return
                    }
                    guard let host = self.bridge?.viewController, host.presentedViewController == nil else {
                        self.scanning = false
                        call.reject("Camera unavailable", "UNAVAILABLE")
                        return
                    }
                    let scanner = IsbnCameraController()
                    scanner.modalPresentationStyle = .fullScreen
                    scanner.complete = { content, error in
                        scanner.dismiss(animated: true) {
                            self.scanning = false
                            if let error { call.reject(error, "UNAVAILABLE") }
                            else { call.resolve(["content": content as Any? ?? NSNull()]) }
                        }
                    }
                    host.present(scanner, animated: true)
                }
            }
        }
    }
}

/** AVFoundation delivers barcode metadata locally; frames are never saved or transmitted. */
private final class IsbnCameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var complete: ((String?, String?) -> Void)?
    private let session = AVCaptureSession()
    private let cameraQueue = DispatchQueue(label: "app.wovenleaf.isbn-camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    private var device: AVCaptureDevice?
    private let torch = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
        let cancel = UIButton(type: .system)
        cancel.setTitle(WovenleafL10n.text("Cancel ISBN scan"), for: .normal)
        cancel.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
        torch.setTitle(WovenleafL10n.text("Turn flashlight on"), for: .normal)
        torch.addTarget(self, action: #selector(toggleTorch), for: .touchUpInside)
        let hint = UILabel()
        hint.text = WovenleafL10n.text("Center the ISBN barcode. Use the torch when the page is dark.")
        hint.numberOfLines = 0
        hint.textAlignment = .center
        hint.textColor = .white
        let controls = UIStackView(arrangedSubviews: [hint, torch, cancel])
        controls.axis = .vertical
        controls.spacing = 16
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.backgroundColor = UIColor.black.withAlphaComponent(0.7)
        controls.isLayoutMarginsRelativeArrangement = true
        controls.layoutMargins = UIEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
        [torch, cancel].forEach { $0.tintColor = .white; $0.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
        view.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controls.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controls.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])
        cameraQueue.async { self.configureCamera() }
    }

    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        cameraQueue.async { self.session.stopRunning() }
        if !finished { finish(nil, nil) }
    }

    private func configureCamera() {
        do {
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                DispatchQueue.main.async { self.finish(nil, "Camera unavailable") }; return
            }
            let input = try AVCaptureDeviceInput(device: camera)
            let output = AVCaptureMetadataOutput()
            session.beginConfiguration()
            guard session.canAddInput(input), session.canAddOutput(output) else {
                session.commitConfiguration()
                DispatchQueue.main.async { self.finish(nil, "Camera unavailable") }; return
            }
            session.addInput(input)
            session.addOutput(output)
            guard output.availableMetadataObjectTypes.contains(.ean13) else {
                session.commitConfiguration()
                DispatchQueue.main.async { self.finish(nil, "Camera unavailable") }; return
            }
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.ean13]
            session.commitConfiguration()
            device = camera
            DispatchQueue.main.async { self.torch.isHidden = !camera.hasTorch }
            session.startRunning()
        } catch {
            DispatchQueue.main.async { self.finish(nil, "Camera unavailable") }
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        finish(value, nil)
    }
    @objc private func cancelScan() { finish(nil, nil) }
    private func finish(_ content: String?, _ error: String?) {
        guard !finished else { return }
        finished = true
        cameraQueue.async { self.session.stopRunning() }
        let callback = complete
        complete = nil
        callback?(content, error)
    }
    @objc private func toggleTorch() {
        cameraQueue.async {
            guard let device = self.device, device.hasTorch else { return }
            do {
                try device.lockForConfiguration()
                device.torchMode = device.torchMode == .on ? .off : .on
                let on = device.torchMode == .on
                device.unlockForConfiguration()
                DispatchQueue.main.async { self.torch.setTitle(WovenleafL10n.text(on ? "Turn flashlight off" : "Turn flashlight on"), for: .normal) }
            } catch { /* Scanning and cancellation remain available without a torch. */ }
        }
    }
}
