import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let response = NSExtensionItem()
        do {
            if message?["type"] as? String == "connection-status" {
                response.userInfo = [SFExtensionMessageKey: ["enabled": try LibbyInbox.enabled()]]
                context.completeRequest(returningItems: [response]); return
            }
            guard let snapshot = message?["snapshot"] else { throw NSError(domain: "WovenleafLibby", code: 1, userInfo: [NSLocalizedDescriptionKey: "No shelf capture was received."]) }
            try LibbyInbox.receive(snapshot)
            response.userInfo = [SFExtensionMessageKey: ["ok": true]]
        } catch {
            response.userInfo = [SFExtensionMessageKey: ["ok": false, "message": error.localizedDescription]]
        }
        context.completeRequest(returningItems: [response])
    }
}
