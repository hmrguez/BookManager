import Capacitor
import UIKit

@objc(WovenleafReviewAccessibilityPlugin)
final class WovenleafReviewAccessibilityPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafReviewAccessibilityPlugin"
    let jsName = "WovenleafReviewAccessibility"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "getPreferences", returnType: CAPPluginReturnPromise)]
    private var observers: [NSObjectProtocol] = []

    override func load() {
        for name in [UIAccessibility.voiceOverStatusDidChangeNotification,
                     UIAccessibility.reduceMotionStatusDidChangeNotification,
                     UIAccessibility.switchControlStatusDidChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.notifyListeners("preferencesChanged", data: ["manual": Self.manual])
            })
        }
    }
    private static var manual: Bool {
        UIAccessibility.isVoiceOverRunning || UIAccessibility.isReduceMotionEnabled || UIAccessibility.isSwitchControlRunning
    }
    @objc func getPreferences(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["manual": Self.manual]) }
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver) }
}
