# App Store preparation assets

## Unlimited web preview

[`wovenleaf-unlimited-web-preview.png`](wovenleaf-unlimited-web-preview.png)
was captured on 3 October 2026 from the current mobile web app at a 390 × 844 CSS
viewport with device scale factor 3 (1170 × 2532 PNG pixels).

It uses the actual shared upgrade dialog and a browser-only purchase adapter,
following `apps/mobile/visual-tests/purchases.spec.ts`, with simulated iOS status
and a US $10.00 price. No production app code was changed, no purchase was made,
and no screenshot pixels were edited. This is a web-preview image, not evidence
of an Apple sandbox transaction or a capture from the native iOS simulator.

The earlier simulator attempt did not produce a final screenshot. Its temporary
Xcode project/scheme changes were removed after the request switched to web.
