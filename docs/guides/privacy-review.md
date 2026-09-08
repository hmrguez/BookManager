# Privacy and terms implementation review

Reviewed 8 September 2026 for the landing page legal documents. This is a source
and dependency review, not a packet capture or a legal compliance certification.

## Current data flows

| Area | Evidence | Disclosure |
| --- | --- | --- |
| Local library and preferences | `apps/mobile/src/storage/`, `search/`, `reader/`, `playback/` | SQLite, local files, preferences, search caches, annotations, and recovery history stay on the device. |
| Online catalog | `apps/mobile/src/metadata/runtime.ts`, `open-library.ts`, `transport.ts` | The active provider is Open Library. Requests include queries/ISBNs and locale; the service receives ordinary connection information. Older architecture notes about Google Books do not describe the active runtime. |
| Goodreads imports | `apps/mobile/src/imports/`, `App.tsx` | CSV parsing, review, and commit are local. Missing-cover enrichment runs automatically after hydration/import and on foregrounding, sending ISBNs or title/author queries to Open Library. |
| Remote covers | `apps/mobile/src/metadata/open-library.ts`, cover rendering | Viewing remote images contacts the cover host. Metadata may provide cover URLs rather than an embedded local image. |
| EPUB and audiobook files | `apps/mobile/src/epub/`, `audiobooks/`, native reader/playback plugins | Imported files are managed locally. EPUB external links open after confirmation. Readium uses HTTP-capable clients; no blanket block of all remote publication resources was established by this review. The policy must not guarantee that arbitrary EPUB content cannot make network requests. |
| Android ISBN scanner | `apps/mobile/src/capture/scanner.ts`, installed `@capacitor/barcode-scanner/android/build.gradle` | The selected backend is ML Kit, with bundled `com.google.mlkit:barcode-scanning:17.3.0`. Google documents diagnostics and usage collection even though recognition is local. |
| Permissions and device surfaces | `apps/mobile/src/capture/`, `playback/AudiobookPlayer.tsx`, `SettingsPage.tsx`, native manifests | Camera scanning, deliberate clipboard reads, chosen/shared files, microphone voice notes, background audio, and optional lock-screen book details. |
| Exports and recovery | `apps/mobile/src/storage/portable-archive.ts`, `recovery.ts`, `recovery-store.ts` | Local portable JSON/CSV/Markdown exports; optional EPUB inclusion. These are not encrypted. Not all media files are included. Recovery/history may preserve older records. |
| Platform backup | Android backup XML and manifest; iOS `AppDelegate.swift` | App-controlled private data is configured for exclusion from automatic backup. User-created exports and selected cloud document providers remain separate. |
| Website | `apps/landing/src/`, `package.json`, `astro.config.mjs`, `vercel.json` | Static Astro pages with locally served fonts/images, no app-added analytics scripts or tracking cookies; Vercel still processes website requests. |
| Support | Legal contact email | User-initiated correspondence can disclose personal information independently of the local app. |

## Claims corrected or avoided

- Replaced the landing page's blanket “No analytics layer” claim because of the
  Android scanner SDK. No change to mobile behavior or SDK configuration is part
  of this task; the current exception is disclosed in the privacy policy.
- Did not claim that only explicit searches contact Open Library: automatic
  Goodreads enrichment and remote image loading are also disclosed.
- Did not describe local databases or exported backups as encrypted.
- Did not promise that deleting an individual book purges history or local
  recovery copies; complete device-data removal and separately saved exports
  are explained.
- Terms assign responsibility for rights in imported content to users, without
  requiring proof of purchase or claiming that a disclaimer eliminates the
  operator's statutory liability. Mandatory consumer rights are preserved.
- Keeping the app strictly offline except for book metadata would require a
  separate change to remove scanner telemetry and verify native EPUB networking.

## Authoritative references

- [Google ML Kit Android data disclosure](https://developers.google.com/ml-kit/android-data-disclosure)
- [Google privacy policy](https://policies.google.com/privacy)
- [Internet Archive terms and privacy](https://archive.org/about/terms)
- [Vercel privacy notice](https://vercel.com/legal/privacy-notice)
- [EDPB guide to individual rights and transparency](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en)
- [EU guidance on unfair contract terms](https://europa.eu/youreurope/citizens/consumers/unfair-treatment/unfair-contract-terms/index_en.htm)

## Maintaining the pages

The public routes are `/privacy/` and `/terms/`. They share `LegalLayout.astro`,
`SiteFooter.astro`, and the public operator details/effective date in
`apps/landing/src/legal.ts`. Update the privacy policy before changing data
flows, integrations, tracking, exports, or hosting practices. Review provider
disclosures again when upgrading the native scanner SDK.
