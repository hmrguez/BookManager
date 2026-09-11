package com.hmrguez.wovenleaf

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.android.billingclient.api.*
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

@CapacitorPlugin(name = "WovenleafPurchases")
class WovenleafPurchasesPlugin : Plugin(), PurchasesUpdatedListener {
    private val productId = "com.hmrguez.wovenleaf.unlimited"
    private lateinit var billing: BillingClient
    private val main = Handler(Looper.getMainLooper())
    private var purchaseCall: PluginCall? = null
    private var connecting = false
    private val connectionWaiters = mutableListOf<(Boolean) -> Unit>()
    private val preferences by lazy { context.getSharedPreferences("wovenleaf-purchases", 0) }
    private val publicKey by lazy { context.getString(R.string.google_play_billing_public_key).trim() }
    private val reviewPreferences by lazy { context.getSharedPreferences("wovenleaf-review-access", 0) }
    private val reviewPublicKey by lazy {
        try { context.assets.open("public/review-access-public-key.txt").bufferedReader().use { it.readText() } }
        catch (_: Exception) { "" }
    }

    @PluginMethod fun getReviewAccess(call: PluginCall) {
        val token = reviewPreferences.getString("token", null)
        call.resolve(JSObject().put("active", ReviewAccessVerifier.verify(token, reviewPublicKey)))
    }

    @PluginMethod fun activateReviewAccess(call: PluginCall) {
        val token = call.getString("token")?.trim()
        if (!ReviewAccessVerifier.verify(token, reviewPublicKey)) {
            call.reject("The review token is invalid for this app.", "INVALID_REVIEW_TOKEN")
            return
        }
        if (!reviewPreferences.edit().putString("token", token).commit()) {
            call.reject("Review access could not be saved.", "STORAGE_ERROR")
            return
        }
        call.resolve(JSObject().put("active", true))
    }

    @PluginMethod fun endReviewAccess(call: PluginCall) {
        if (!reviewPreferences.edit().remove("token").commit()) {
            call.reject("Review access could not be removed.", "STORAGE_ERROR")
            return
        }
        call.resolve(JSObject().put("active", false))
    }

    override fun load() {
        billing = BillingClient.newBuilder(context)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build()
    }

    private fun connect(callback: (Boolean) -> Unit) {
        if (billing.isReady) { callback(true); return }
        connectionWaiters.add(callback)
        if (connecting) return
        connecting = true
        val timeout = Runnable { finishConnection(false) }
        main.postDelayed(timeout, 15000)
        billing.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                main.post {
                    main.removeCallbacks(timeout)
                    finishConnection(result.responseCode == BillingClient.BillingResponseCode.OK)
                }
            }
            override fun onBillingServiceDisconnected() { }
        })
    }

    private fun finishConnection(ready: Boolean) {
        connecting = false
        val callbacks = connectionWaiters.toList()
        connectionWaiters.clear()
        callbacks.forEach { it(ready) }
    }

    /** Verify the store-signed receipt before granting or reading cached access. No editable boolean unlock. */
    private fun verified(purchase: Purchase): Boolean = try {
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(publicKey, Base64.DEFAULT)))
        val verifier = Signature.getInstance("SHA1withRSA")
        verifier.initVerify(key)
        verifier.update(purchase.originalJson.toByteArray(Charsets.UTF_8))
        verifier.verify(Base64.decode(purchase.signature, Base64.DEFAULT)) &&
            purchase.packageName == context.packageName && productId in purchase.products &&
            purchase.purchaseState == Purchase.PurchaseState.PURCHASED
    } catch (_: Exception) { false }

    private fun cachedOwnership(): Boolean = try {
        val receipt = preferences.getString("receipt", null)
        val signature = preferences.getString("signature", null)
        receipt != null && signature != null && verified(Purchase(receipt, signature))
    } catch (_: Exception) { false }

    private fun status(owned: Boolean, pending: Boolean, product: ProductDetails?): JSObject {
        val offer = product?.oneTimePurchaseOfferDetailsList?.firstOrNull { it.purchaseOptionId == "buy" }
        return JSObject().apply {
            put("platform", "android")
            put("owned", owned)
            put("pending", pending)
            put("available", offer != null && publicKey.isNotEmpty())
            if (offer != null) put("price", offer.formattedPrice)
        }
    }

    private fun product(callback: (ProductDetails?) -> Unit) {
        val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(
            QueryProductDetailsParams.Product.newBuilder().setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP).build()
        )).build()
        billing.queryProductDetailsAsync(params) { result, details ->
            callback(if (result.responseCode == BillingClient.BillingResponseCode.OK)
                details.productDetailsList.firstOrNull { it.productId == productId } else null)
        }
    }

    private fun refresh(call: PluginCall, explicitRestore: Boolean) {
        connect { ready ->
            if (!ready) {
                if (explicitRestore) call.reject("Google Play could not restore purchases.", "STORE_ERROR")
                else call.resolve(status(cachedOwnership(), false, null))
                return@connect
            }
            billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build()) { result, purchases ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    if (explicitRestore) call.reject("Google Play could not restore purchases.", "STORE_ERROR")
                    else call.resolve(status(cachedOwnership(), false, null))
                    return@queryPurchasesAsync
                }
                val matching = purchases.filter { productId in it.products }
                val pending = matching.any { it.purchaseState == Purchase.PurchaseState.PENDING }
                val purchased = matching.firstOrNull { verified(it) }
                if (matching.any { it.purchaseState == Purchase.PurchaseState.PURCHASED } && purchased == null) {
                    preferences.edit().clear().apply()
                    // Clear the JS entitlement too; rejecting would retain a previously cached status.
                    call.resolve(status(false, pending, null))
                    return@queryPurchasesAsync
                }
                if (purchased == null) {
                    // A successful empty query is authoritative: refunds/account changes remove access.
                    preferences.edit().clear().apply()
                    product { call.resolve(status(false, pending, it)) }
                } else {
                    deliver(purchased) { delivered ->
                        if (!delivered) call.reject("Google Play could not acknowledge the purchase. Try restoring again.", "STORE_ERROR")
                        else call.resolve(status(true, pending, null))
                    }
                }
            }
        }
    }

    private fun deliver(purchase: Purchase, callback: (Boolean) -> Unit) {
        if (!verified(purchase)) { callback(false); return }
        fun save() {
            preferences.edit().putString("receipt", purchase.originalJson)
                .putString("signature", purchase.signature).apply()
            callback(true)
        }
        if (purchase.isAcknowledged) save()
        else billing.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken).build()) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) save()
            else callback(false)
        }
        // Never consume: this product permanently belongs to the customer's store account.
    }

    @PluginMethod fun getStatus(call: PluginCall) { main.post { refresh(call, false) } }
    @PluginMethod fun restore(call: PluginCall) { main.post { refresh(call, true) } }

    @PluginMethod fun purchase(call: PluginCall) {
        main.post {
            if (purchaseCall != null) { call.reject("A purchase is already in progress.", "BUSY"); return@post }
            if (publicKey.isEmpty()) { call.reject("Configure the Play licensing public key first.", "UNAVAILABLE"); return@post }
            purchaseCall = call
            connect { ready ->
                if (!ready) { rejectPurchase(); return@connect }
                product { details ->
                    main.post {
                        val offer = details?.oneTimePurchaseOfferDetailsList?.firstOrNull { it.purchaseOptionId == "buy" }
                        if (details == null || offer == null) { rejectPurchase(); return@post }
                        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details)
                        offer.offerToken?.let { productParams.setOfferToken(it) }
                        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(productParams.build())).build()
                        val result = billing.launchBillingFlow(activity, params)
                        if (result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                            finishPurchase("purchased")
                        } else if (result.responseCode != BillingClient.BillingResponseCode.OK) rejectPurchase()
                    }
                }
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        main.post {
            if (result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
                finishPurchase("cancelled"); return@post
            }
            if (result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                finishPurchase("purchased"); return@post
            }
            if (result.responseCode != BillingClient.BillingResponseCode.OK) { rejectPurchase(); return@post }
            val purchase = purchases?.firstOrNull { productId in it.products }
            if (purchase == null) { rejectPurchase(); return@post }
            if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
                finishPurchase("pending"); return@post
            }
            deliver(purchase) { success ->
                main.post { if (success) finishPurchase("purchased") else rejectPurchase() }
            }
        }
    }

    private fun finishPurchase(outcome: String) {
        purchaseCall?.resolve(JSObject().put("outcome", outcome))
        purchaseCall = null
        notifyListeners("purchaseChanged", JSObject())
    }

    private fun rejectPurchase() {
        purchaseCall?.reject("Google Play could not complete the purchase. Try restoring if you were charged.", "STORE_ERROR")
        purchaseCall = null
    }

    @PluginMethod fun redeem(call: PluginCall) {
        main.post {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem"))
                    .setPackage("com.android.vending"))
                call.resolve()
            } catch (_: Exception) { call.reject("Google Play is unavailable.", "UNAVAILABLE") }
        }
    }

    override fun handleOnDestroy() {
        rejectPurchase()
        billing.endConnection()
        super.handleOnDestroy()
    }
}
