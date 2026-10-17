package com.hmrguez.wovenleaf

import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/** Small native camera surface with named, reachable torch and cancel controls. */
class WovenleafScanActivity : CaptureActivity() {
    override fun initializeContent(): DecoratedBarcodeView {
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val camera = DecoratedBarcodeView(this)
        root.addView(camera, LinearLayout.LayoutParams(-1, 0, 1f))
        val controls = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(16, 12, 16, 24) }
        var torchOn = false
        val torch = Button(this).apply {
            text = WovenleafL10n.text("Turn flashlight on")
            minHeight = (48 * resources.displayMetrics.density).toInt()
            visibility = if (packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) android.view.View.VISIBLE else android.view.View.GONE
            setOnClickListener {
                torchOn = !torchOn
                if (torchOn) camera.setTorchOn() else camera.setTorchOff()
                text = WovenleafL10n.text(if (torchOn) "Turn flashlight off" else "Turn flashlight on")
            }
        }
        val cancel = Button(this).apply {
            text = WovenleafL10n.text("Cancel ISBN scan")
            minHeight = (48 * resources.displayMetrics.density).toInt()
            setOnClickListener { setResult(Activity.RESULT_CANCELED); finish() }
        }
        controls.addView(torch, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(cancel, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(controls)
        setContentView(root)
        return camera
    }
}
