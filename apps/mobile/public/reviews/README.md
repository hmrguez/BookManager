# Quarterly review artwork

`concepts/` retains byte-for-byte copies of the accepted cropped originals. No
artwork was regenerated for the static design revision.

`ink-v1/` contains transparent black-ink PNGs derived at the original dimensions
by `python3 apps/mobile/scripts/prepare-review-ink.py` (Python + Pillow). The alpha
channel is `round(max(0, 240 - luminance) * 255 / 240)`: near-white paper texture
becomes transparent while shading/antialiasing remain continuous. Composition,
line placement and the small medallions are preserved. Source files remain intact.

The UI uses these PNGs as CSS alpha masks filled with the theme's text/ink colour.
Images remain decodable with intrinsic dimensions and error handling; missing or
corrupt artwork preserves identity text and navigation. Known concept-v1 keepsakes
resolve to their corresponding ink asset without changing their stored manifest or
facts; new keepsakes record `original-ink-v1`. Unknown versions retain their own
still. No pathway animation is played or requested.

`fantasy-preview-v1/` remains solely for old version references and historical
compatibility. It is no longer used by the UI. Production-art review still owns
individual final visual approval and replacing temporary Lucide achievement seals.
