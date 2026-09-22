import Capacitor
import WidgetKit

@objc(WovenleafWidgetsPlugin)
public class WovenleafWidgetsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WovenleafWidgetsPlugin"
    public let jsName = "WovenleafWidgets"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "publish", returnType: CAPPluginReturnPromise)]

    @objc func publish(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot"), let data = snapshot.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["version"] as? Int == 1,
              let defaults = UserDefaults(suiteName: "group.com.hmrguez.wovenleaf") else {
            call.reject("Invalid widget snapshot"); return
        }
        if defaults.string(forKey: "reading-widget-snapshot") != snapshot {
            defaults.set(snapshot, forKey: "reading-widget-snapshot")
            WidgetCenter.shared.reloadTimelines(ofKind: "WovenleafReading")
            WidgetCenter.shared.reloadTimelines(ofKind: "WovenleafStreak")
        }
        call.resolve()
    }
}
