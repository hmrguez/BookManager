import Capacitor
import StoreKit
import UIKit

@objc(WovenleafPurchasesPlugin)
final class WovenleafPurchasesPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafPurchasesPlugin"
    let jsName = "WovenleafPurchases"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "redeem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getReviewAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activateReviewAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endReviewAccess", returnType: CAPPluginReturnPromise),
    ]
    private let productID = "com.hmrguez.wovenleaf.unlimited"
    private var updates: Task<Void, Never>?
    private var purchasing = false
    private var pending = false
    private let reviewTokenKey = "wovenleaf.review-access.token"
    private lazy var reviewPublicKey: String = {
        guard let url = Bundle.main.url(forResource: "review-access-public-key", withExtension: "txt", subdirectory: "public")
        else { return "" }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }()

    @objc func getReviewAccess(_ call: CAPPluginCall) {
        let token = UserDefaults.standard.string(forKey: reviewTokenKey) ?? ""
        call.resolve(["active": ReviewAccessVerifier.verify(token, publicKeyDER: reviewPublicKey)])
    }

    @objc func activateReviewAccess(_ call: CAPPluginCall) {
        let token = (call.getString("token") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard ReviewAccessVerifier.verify(token, publicKeyDER: reviewPublicKey) else {
            call.reject("The review token is invalid for this app.", "INVALID_REVIEW_TOKEN")
            return
        }
        UserDefaults.standard.set(token, forKey: reviewTokenKey)
        call.resolve(["active": true])
    }

    @objc func endReviewAccess(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: reviewTokenKey)
        call.resolve(["active": false])
    }

    override func load() {
        // Start before requesting products so Ask to Buy and external redemptions are delivered.
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                guard case .verified(let transaction) = result,
                      transaction.productID == self.productID else { continue }
                await transaction.finish()
                self.pending = false
                self.notifyListeners("purchaseChanged", data: [:])
            }
        }
    }

    deinit { updates?.cancel() }

    private func status() async -> JSObject {
        var owned = false
        // StoreKit supplies verified, locally cached entitlements, including offline access.
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == productID,
               transaction.revocationDate == nil {
                owned = true
            }
        }
        // An owned product needs no network price lookup to remain usable offline.
        let product: Product? = owned ? nil : (try? await Product.products(for: [productID]).first)
        var result: JSObject = [
            "platform": "ios", "owned": owned, "pending": pending && !owned,
            "available": product?.type == .nonConsumable,
        ]
        if #available(iOS 16.3, *) { result["canRedeem"] = true }
        else { result["canRedeem"] = false }
        if let product { result["price"] = product.displayPrice }
        return result
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        Task { call.resolve(await status()) }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard !purchasing else {
                call.reject("A purchase is already in progress.", "BUSY")
                return
            }
            purchasing = true
            defer { purchasing = false }
            do {
                guard let product = try await Product.products(for: [productID]).first,
                      product.type == .nonConsumable else {
                    call.reject("The upgrade is not available in this storefront.", "UNAVAILABLE")
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    guard case .verified(let transaction) = verification,
                          transaction.productID == productID,
                          transaction.revocationDate == nil else {
                        call.reject("The purchase could not be verified.", "UNVERIFIED")
                        return
                    }
                    await transaction.finish()
                    call.resolve(["outcome": "purchased"])
                    notifyListeners("purchaseChanged", data: [:])
                case .pending:
                    pending = true
                    call.resolve(["outcome": "pending"])
                case .userCancelled:
                    call.resolve(["outcome": "cancelled"])
                @unknown default:
                    call.reject("The store returned an unknown purchase result.", "UNKNOWN")
                }
            } catch {
                call.reject("The App Store could not complete the purchase.", "STORE_ERROR")
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                // Explicit user action: sync may ask the customer to authenticate.
                try await AppStore.sync()
                call.resolve(await status())
            } catch {
                call.reject("The App Store could not restore purchases.", "STORE_ERROR")
            }
        }
    }

    @objc func redeem(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard #available(iOS 16.3, *) else {
                call.reject("Redeeming this upgrade requires iOS 16.3 or later.", "UNAVAILABLE")
                return
            }
            guard let scene = bridge?.viewController?.view.window?.windowScene else {
                call.reject("Open the app before redeeming a code.", "NO_SCENE")
                return
            }
            do {
                try await AppStore.presentOfferCodeRedeemSheet(in: scene)
                call.resolve()
                notifyListeners("purchaseChanged", data: [:])
            } catch {
                call.reject("The App Store could not open code redemption.", "STORE_ERROR")
            }
        }
    }
}
