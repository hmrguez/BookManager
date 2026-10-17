# Wovenleaf open-source readiness audit

> Historical findings, remediated by the [public-readiness cleanup](public-readiness-remediation-2026-10-17.md).
> Old commit hashes and paths below describe the pre-cleanup baseline.

Date: 17 October 2026. Baseline: `ac6b5db`, plus the payment-removal changes
recorded with this audit. This is a repository and distribution-readiness review,
not a certification of every asset or dependency.

## Outcome

The original application code now has an MIT license naming Hector Rodriguez.
MIT permits commercial use and closed-source forks while requiring retention of
the copyright and permission notices in copies or substantial portions. It does
not require visible author credit in an app interface or advertisement.
See the [OSI MIT text](https://opensource.org/license/mit).

All library entries are free, with no book-count gate. Native StoreKit/Play Billing
plugins, Android billing dependency and public key, reviewer-token validators,
reviewer public key and signing scripts, upgrade/restore UI, and unused purchase
translations were removed. Manual writes, reviewed CSV imports, EPUB/audio imports,
and archive restore use their normal storage transactions without a purchase check.
Existing library schemas and application identifiers are preserved.

**Before presenting the entire repository as freely reusable, resolve third-party
media rights and prepare dependency notices/source availability.** An MIT license
on our code cannot grant rights in other people's covers, books, trademarks, or
libraries. A fully open-source Android binary also needs a scanner-dependency change.

## Findings, ordered by priority

| Priority | Finding and evidence | Required follow-up |
| --- | --- | --- |
| High: media redistribution | `branding/marketing/covers/`, `branding/marketing/covers/sources.json`, `branding/marketing/README.md`, `branding/app-store/screenshots/ipad-demo-books.json`, and screenshots under `apps/landing/public/` and `branding/` contain third-party book covers. The marketing README explicitly says the covers remain their holders' property and the source URLs grant no rights. It also identifies a reader screenshot of *The Shape of Falling*. Embedded book text needs its own review. | Replace uncertain covers/text with original or demonstrably redistributable examples, or record permission and exact license per asset. Regenerate screenshots and derived infographics consistently. Review Git history too if publishing history; deleting current images alone does not remove earlier copies. |
| High: dependency notices and MPL source | `@capgo/capacitor-share-target@8.0.49` declares **MPL-2.0**, and `apps/mobile/patches/@capgo%2Fcapacitor-share-target@8.0.49.patch` modifies its native source. No root third-party-notices bundle was present. | Retain upstream notices, identify the modified covered files as MPL, make their corresponding source including modifications available to recipients, and tell binary recipients how to obtain it. The surrounding original app may remain MIT. Pin the upstream revision/package and patch in release source archives. See [Mozilla's distribution FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). |
| High for an entirely free-software Android distribution | `@capacitor/barcode-scanner@3.1.1/android/build.gradle` brings in `com.google.mlkit:barcode-scanning:17.3.0`, ZXing, and `io.ionic.libs:ionbarcode-android:2.1.1@aar`. The wrapper's MIT declaration does not license the whole dependency tree. [ML Kit terms](https://developers.google.com/ml-kit/terms) restrict source extraction/reverse engineering and describe usage/performance metrics. | For a fully open-source Android build, replace/exclude ML Kit and verify every native artifact, or provide a build flavor without the scanner. Choosing a ZXing runtime option alone does not prove ML Kit is absent from the binary. Manual ISBN entry already exists. This does not prevent publishing Wovenleaf's own source under MIT. |
| Medium: transitive/native license inventory | Runtime packages include MIT, ISC, MPL-2.0, OFL-1.1, and dual-licensed JSZip. Native build definitions add Readium, SQLCipher/ZIPFoundation, AndroidX/Media3, scanner libraries, and their transitive dependencies. | Generate an inventory from the resolved JavaScript, Gradle, and Swift graphs for each released build. Include required license texts, copyright notices, and any NOTICE files. Record the selected MIT option for JSZip. Do not assume JavaScript package metadata covers bundled native libraries. |
| Medium: artwork provenance | `apps/mobile/public/reviews/README.md` records accepted concept artwork, crops, masks, hashes, and original achievement vectors, but does not establish a license/provenance grant for every original bitmap. `docs/design/` also retains reference/concept images. | Confirm authorship or generation/source terms for original artwork and reference images. Record the intended reuse license for owned artwork; exclude or replace anything without redistribution rights. Transforming an image into a mask does not establish ownership of its source. |
| Medium: trademark/service marks | `apps/mobile/public/services/README.md` identifies an official Libby icon and a Goodreads icon; `apps/landing/public/store-logos/README.md` identifies Apple/Google marks from Simple Icons. The official Libby PNG has a source URL but no recorded redistribution license. | Check the applicable permission/brand-use conditions, replace uncertain marks with text where appropriate, and distinguish trademarks from the MIT code grant. CC0 icon artwork does not transfer trademark rights. Decide whether forks may use Wovenleaf branding or should rename their app. |
| Medium: secret-prevention gaps | Root `.gitignore` only ignores `*.local` and specific old reviewer outputs; Android's template has `*.jks` and `*.keystore` commented out. Generic `.env`, signing certificates, service-account exports, and signing-property files are not comprehensively excluded. | Add explicit secret/signing exclusions while retaining safe example files, and add a maintained secret scanner to pre-publication/CI checks. Keep signing keys outside the checkout. No matching committed private key or known token pattern was found in the scoped scan below. |
| Medium: personal data in artifacts/history | `docs/verification/`, `docs/research/`, `docs/spikes/`, and marketing captures contain screenshots, sample libraries, source URLs, machine paths, device/build identifiers, and operational release records. Some are documented as synthetic; that does not establish the privacy of all images. | Visually review the publication set for real reading histories, messages, account/card details, console screenshots, contact details, and download URLs. Keep only intended public operator details. Obtain consent or replace/redact private captures. Text secret scanning cannot inspect their pixels. |
| Medium: service terms and privacy | Open Library search/cover requests are implemented in `apps/mobile/src/metadata/open-library.ts`. The Libby companion interacts with `libbyapp.com`, browser/native messaging, and a local bridge. `apps/landing/src/components/PrivacyPage.astro` already discloses ML Kit metrics and external requests. | Preserve provider attribution, review provider/extension-store terms, and explain that users supply their own service/library access. Open-sourcing the client grants no rights to catalog imagery, accounts, DRM content, or third-party service access. Reconcile privacy text if dependencies change. |
| Medium: distribution still assumes stores | README/native identifiers, signing setup, App Groups, extension distribution, and landing-page download links are oriented toward Apple/Google stores. `apps/landing/README.md` describes store buttons and says the landing page does not link to a web app. | Choose and document supported community distribution paths: Android APK releases, browser/PWA where supported, and an honest iOS build/install path. Open-sourcing does not itself remove platform signing/install requirements or give the browser native feature parity. Test actual supported platforms before promising a store-free installation experience. |
| Low: contributor onboarding | Main build instructions and lockfiles exist, but no root CONTRIBUTING/SECURITY policy or public issue workflow was found. Internal instructions refer contributors to Linear and local agent skills. | Document a clean-clone build, supported toolchains/platforms, patch application, tests, bug reporting, security contact, and contribution workflow without requiring access to private Linear projects. Keep internal/local tooling optional. |
| Operational: existing paid releases | Local purchase documentation and the App Store listing draft now describe retirement; the old iOS guide is explicitly historical. | The owner must separately retire remote products/upgrade marketing and decide treatment of any prior purchasers. Existing installed binaries retain their earlier behavior until updated. No store-account configuration, refund, repository visibility, or public release was changed by this task. |

## Dependency evidence

Installed direct runtime metadata was checked rather than inferred from package names:

| License | Packages |
| --- | --- |
| MIT | Capacitor core/app/filesystem/clipboard/barcode-scanner, Aparajita secure storage, capacitor-community SQLite, TanStack virtual, xmldom, i18next/react-i18next, jeep-sqlite, pdf-lib, React/React DOM, sql.js, Zod; Astro in the landing page |
| MPL-2.0 | Capgo capacitor-share-target 8.0.49; locally patched |
| OFL-1.1 | IBM Plex Sans and Literata from Fontsource; retain font licenses and check font naming restrictions when modifying fonts |
| ISC | lucide-react 1.33.0; review any additional bundled icon notices in the full inventory |
| MIT OR GPL-3.0-or-later | JSZip 3.10.1; select MIT for this distribution |

This is a direct dependency inventory, not a complete SBOM. In particular,
`@capacitor/barcode-scanner/Package.swift` resolves OutSystems' OSBarcodeLib on iOS;
[its upstream repository](https://github.com/OutSystems/OSBarcodeLib-iOS) currently
identifies MIT, but the exact resolved release and transitive code still need
inclusion in the native inventory. SQLCipher community code and platform media
frameworks must also be checked at their actual resolved versions; an encryption
library is not inherently a paid component.

Some fixtures already have good provenance: the generated EPUB corpus is explicitly
CC0 (`apps/mobile/tests/fixtures/epub-corpus/README.md`), and the original Pride and
Prejudice demo cover has a recorded public-domain dedication in the marketing
README. Those examples do not license unrelated commercial cover artwork.

## Secret scan and scope limits

- Inspected tracked filenames for environment files, private signing material,
  database exports, book/audio files, and license files. The tracked `.env.example`
  and `.env.development` contain feature flags and optional extension listing URLs,
  not credentials. No tracked `.p8`, `.p12`, `.jks`, `.keystore`, or private PEM file
  appeared in that filename inventory.
- Scanned **2,358 text blobs** across all locally reachable Git refs (**239 commits**
  at audit time), using signatures for PEM private-key headers, AWS access keys,
  GitHub tokens, Google API keys, Stripe secret/restricted keys, and Slack tokens.
  **Zero matches.** Binary blobs, text over 3 MB, image pixels, dangling/unfetched
  history, ignored local files, generic passwords, and arbitrary custom tokens were
  outside this scan. This is narrower than a dedicated secret scanner.
- Removed billing/reviewer **public** keys were not secrets. The audit did not find
  their private counterparts. Old runtime receipts/preferences, if present on a
  user's device, are no longer read for access; no reader data migration is needed.
- Pre-existing untracked `.agents/` and `skills-lock.json` were left out of this
  task. Audit them separately if choosing to publish them later.
- No remote store console, hosted deployment, repository visibility, account,
  credentials, purchase history, or refund state was inspected or changed.

## Verification of the free application

From `apps/mobile`:

- `bun run lint` and `bun run typecheck` pass.
- `bun run test`: **534 tests pass**, including new unlimited-library tests,
  CSV commit/undo/retry, EPUB/audio imports past 30, and portable archive restore.
- `bun run build` succeeds; the bundler still reports large chunks and an existing
  mixed static/dynamic Libby import warning.
- `bunx playwright test visual-tests/unlimited-library.spec.ts`: passes. A manual
  31st book persists after reload; settings contain no paid upgrade/reviewer UI;
  no page errors or horizontal overflow were detected. Mobile settings capture
  was inspected visually.
- Android `./gradlew :app:compileDebugKotlin :app:compileDebugJavaWithJavac --offline`
  succeeds after removing the billing dependency and plugin. Existing platform/Gradle
  deprecation warnings remain. This checks native compilation, not device behavior.
- Landing `bun run lint` and `bun run typecheck` pass after adding license metadata.
- Xcode project structure passes `plutil -lint`; removed plugin registrations,
  source references, and the purchase capability were checked. No full iOS native
  build or device run was performed in this audit.

Safety limits on malformed/oversized files, database integrity, DRM compatibility,
and available device storage remain. They protect files and app stability and are
unrelated to monetization; unlimited entries do not mean unlimited physical storage.
