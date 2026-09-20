import Capacitor
import Foundation

@objc(WovenleafLibbyPlugin)
final class WovenleafLibbyPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafLibbyPlugin"
    let jsName = "WovenleafLibby"
    let pluginMethods = ["configure", "pending", "acknowledge"].compactMap {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    @objc func configure(_ call: CAPPluginCall) {
        do { try LibbyInbox.configure(enabled: call.getBool("enabled") ?? false); call.resolve() }
        catch { call.reject(error.localizedDescription) }
    }
    @objc func pending(_ call: CAPPluginCall) {
        do { call.resolve(["snapshots": try LibbyInbox.pending()]) }
        catch { call.reject(error.localizedDescription) }
    }
    @objc func acknowledge(_ call: CAPPluginCall) {
        do { try LibbyInbox.acknowledge(call.getArray("ids", String.self) ?? []); call.resolve() }
        catch { call.reject(error.localizedDescription) }
    }
}
