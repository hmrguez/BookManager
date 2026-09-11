# Wovenleaf — Google Play assets

Prepared 11 September 2026 from the landing app and approved branding files. The live landing page was checked at https://wovenleaf.app/.

## Upload fields

- **App icon:** [google-play-icon-512.png](google-play-icon-512.png).
- **Feature graphic:** [feature-graphic-1024x500.png](feature-graphic-1024x500.png).
- **Feature graphic alt text:** “Wovenleaf brings a book library, EPUB reader and audiobook player together. All your reading. One quiet place.”
- **Phone screenshots:** the three originals are included byte-for-byte. They are source material, not a verified Android upload set; see the notes below.

A feature graphic is a wide promotional image used on Google Play discovery surfaces and as the preview-video cover when a video exists. Google requires 1024 × 500 pixels, JPEG or 24-bit PNG without alpha. Keep important content away from edges and do not include store badges or promotional price/ranking claims.

## Screenshot notes

The original library (390 × 844), reader (973 × 2048), and player (376 × 844) images all exceed Google’s maximum 2:1 long-to-short ratio. The library is a web capture with a scrollbar and desktop shortcut; the reader shows an iOS home indicator. The audiobook image uses a documented static marketing fixture. Copies here retain the originals exactly. Capture the current Android build for an unambiguous Android screenshot set, or prepare accurately framed promotional screenshots from suitable Android captures. Padding alone would not resolve the platform/provenance differences.

The three existing 1080 × 1350 campaign PNGs fit the basic aspect-ratio range, but contain alpha channels and retain their original screenshot provenance. They are copied as source artwork, not certified as publication-ready screenshots. Their editable SVGs are included.

## Inventory scope

This package indexes every screenshot, campaign PNG, and icon file under apps/landing/public (nine image files), and includes the associated campaign SVGs plus the main approved logo variants and store icons. Native Android density variants, splash screens, and internal QA evidence are outside the landing asset set and are not duplicated here.

The landing logo is also used as the favicon and on legal pages; those are repeated uses of the same file. Screenshots under branding/marketing/screenshots and campaign PNGs under branding/marketing/infographics are source counterparts; only one copy of each landing asset is included. Exact original paths, dimensions, sizes, and SHA-256 hashes are in [asset-manifest.json](asset-manifest.json).

## Play upload

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [feature-graphic-1024x500.png](feature-graphic-1024x500.png) | 1024 × 500 | New AI-composited promotional graphic based on the supplied assets. Verified 1024 × 500, 24-bit RGB PNG with no alpha. This is marketing artwork, not a raw app screenshot. |
| [google-play-icon-512.png](google-play-icon-512.png) | 512 × 512 | Play Console app icon: verified 512 × 512, 32-bit RGBA PNG, under 1 MB. Visual pixels match the original icon. |

## screenshots

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [screenshot-01-library.jpg](screenshot-01-library.jpg) | 390 × 844 | Library and shelves. Web capture; visible desktop shortcut and scrollbar. Taller than Play’s 2:1 limit. |
| [screenshot-02-reader.jpg](screenshot-02-reader.jpg) | 973 × 2048 | Native EPUB reader, user-supplied capture. Visible iOS home indicator; taller than Play’s 2:1 limit. |
| [screenshot-03-audiobook.jpg](screenshot-03-audiobook.jpg) | 376 × 844 | Production player UI with static marketing fixture data, not evidence of playback. Taller than Play’s 2:1 limit. |

## campaign

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [campaign-01-track.png](campaign-01-track.png) | 1080 × 1350 | Existing Track campaign artwork; PNG contains an alpha channel. |
| [campaign-02-read.png](campaign-02-read.png) | 1080 × 1350 | Existing Read campaign artwork; includes the supplied reader capture; PNG contains an alpha channel. |
| [campaign-03-listen.png](campaign-03-listen.png) | 1080 × 1350 | Existing Listen campaign artwork; uses the static player fixture; PNG contains an alpha channel. |

## editable campaign

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [campaign-01-track.svg](campaign-01-track.svg) | 1080 × 1350 viewBox / scalable | Editable vector composition with embedded screenshot. |
| [campaign-02-read.svg](campaign-02-read.svg) | 1080 × 1350 viewBox / scalable | Editable vector composition with embedded screenshot. |
| [campaign-03-listen.svg](campaign-03-listen.svg) | 1080 × 1350 viewBox / scalable | Editable vector composition with embedded screenshot. |

## logos

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [wovenleaf-logo.svg](wovenleaf-logo.svg) | 3000 × 3000 viewBox / scalable | Landing page logo and favicon; same bytes as the canonical SVG master. |
| [wovenleaf-logo-2048.png](wovenleaf-logo-2048.png) | 2048 × 2048 | Canonical high-resolution raster logo. |
| [wovenleaf-wordmark.svg](wovenleaf-wordmark.svg) | 1100 × 260 viewBox / scalable | Approved horizontal leaf-and-wordmark lockup. |
| [wovenleaf-wordmark-1024.png](wovenleaf-wordmark-1024.png) | 1024 × 252 | Transparent horizontal lockup export. |
| [wovenleaf-logo-monochrome.svg](wovenleaf-logo-monochrome.svg) | 3000 × 3000 viewBox / scalable | Single-color logo. |
| [wovenleaf-logo-reversed.svg](wovenleaf-logo-reversed.svg) | 3000 × 3000 viewBox / scalable | Logo for dark backgrounds. |
| [wovenleaf-logo-small.svg](wovenleaf-logo-small.svg) | 3000 × 3000 viewBox / scalable | Simplified approved logo for small sizes. |

## store icons

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [app-store-icon-1024.png](app-store-icon-1024.png) | 1024 × 1024 | Existing Apple App Store icon. |
| [google-play-icon-original-512.png](google-play-icon-original-512.png) | 512 × 512 | Original RGB store icon. Use the 32-bit google-play-icon-512.png export for Play Console. |

## platform marks

| File | Dimensions | Use / source notes |
| --- | --- | --- |
| [platform-apple.svg](platform-apple.svg) | 24 × 24 viewBox / scalable | Apple mark from the landing download link; not the Wovenleaf app icon. |
| [platform-google-play.svg](platform-google-play.svg) | 24 × 24 viewBox / scalable | Google Play mark from the landing download link; do not use as the app icon or add it to the feature graphic. |

## Provenance and editing

The feature graphic was made with the built-in image generation tool using the three existing screenshots and approved horizontal lockup. [The exact prompt](feature-graphic-prompt.txt) is included. It is AI-composited promotional art; use the original screenshot files when you need an unchanged capture. The export was normalized to Google’s exact size and opaque RGB PNG format.

Book covers remain the property of their respective rights holders. The player’s Pride and Prejudice cover is original project artwork; its fixture details are documented in branding/marketing/README.md. The existing Canva campaign is https://www.canva.com/design/DAHUU_EqUyQ/vsVhApN-YGWeehPXHvpRvQ/edit . No Canva design was changed in this task.

Apple and Google Play platform marks are included because they occur in the landing app; see [their source notes](platform-marks-sources.md). They are not Wovenleaf logos.

Google’s current requirements: https://support.google.com/googleplay/android-developer/answer/9866151?hl=en
