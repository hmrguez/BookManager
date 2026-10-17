# Public-source readiness remediation

17 October 2026. This record supersedes the unresolved findings in the
[initial audit](open-source-readiness-2026-10-17.md).

## Changes

- The app remains free and unlimited under MIT, naming Hector Rodriguez.
- Replaced the entire Capacitor/OutSystems scanner package. Android uses
  JourneyApps ZXing Embedded 4.3.0 and ZXing core 3.5.3 (Apache-2.0); iOS uses
  AVFoundation; browsers use ZXing. Native camera surfaces have cancellation and
  torch controls; the browser exposes a torch where supported. Frames are not
  uploaded or retained. Manual entry and permission-denied fallbacks remain.
- Removed uncertain third-party covers, book-page screenshots, narrated samples,
  concept/reference bitmaps, compressed provider-response dumps, old store
  exports, and internal capture/research bundles. Replaced live UI artwork with
  original geometric SVGs and public marketing with original illustrations using
  fictional books and original text. Cover-import tests use original generated
  JPEG fixtures. No service/store logos remain in the product or website.
- Saved quarterly identities/facts stay intact. Recognized old illustration paths
  resolve to `vector-v2` without mutating the saved record or requiring the old
  bitmap files. Unknown user artwork references retain their existing fallback.
- `ASSET_LICENSES.json` records hashes and provenance for 83 retained/generated
  media files. Owner-provided Wovenleaf identity assets and their platform
  derivatives remain; original synthetic sounds and test-gallery captures remain.
  Runtime fonts retain their upstream OFL notices. User-imported books and remote
  covers are not licensed or distributed by the source repository.
- Inventoried **192 distinct resolved runtime dependency/version entries** across
  JavaScript, Android release, and Swift. Retained upstream notices and common
  license texts, including SQLCipher Community and its attribution. JSZip uses
  the MIT option. Development/static-site compiler executables are not included
  in redistributed application/site runtime; the distributed Gradle wrapper's
  own license and NOTICE are included separately.
- Bundled readable notices into the mobile settings and static website. The
  modified Capgo share-target 8.0.49 source, exact upstream revision, preferred
  TypeScript source, native source, build configuration, license, and patch are
  provided under MPL-2.0 in `third_party/capacitor-share-target/`. The root MIT
  license does not override covered third-party files.
- Updated privacy copy in all five languages and replaced misleading store
  buttons with source/build instructions. Added public contribution/security
  policies and Android/iOS/web build instructions with platform limitations.
- Added secret/signing exclusions and publication checks. CI runs Gitleaks over
  reachable history, verifies media hashes/provenance and dependency inputs,
  checks bundled notices/source, and builds/tests the app and website.

## History and publication boundary

The owner explicitly authorized rewriting this repository's history. Restricted
historical blobs are removed from local branches/tags/history after a recovery
copy is saved outside the checkout. The rewrite removed 373 historical blobs from reachable refs and reduced 241
commits to 202 by dropping empty commits. The latest committed source tree was
verified byte-for-byte unchanged by the rewrite. Three private editor checkpoint
refs retaining old images were backed up and removed separately. Old hashes in the initial audit or
retained architecture records may no longer identify reachable commits.

The private recovery copy deliberately retains the original history. It must not
be uploaded or included in a public source archive. It is for local recovery only.
The existing Android version edit and local agent installations are preserved.
Five other registered worktree indexes still retain 262 unreachable private
objects in the shared local object store; their unrelated state was preserved.
They are not reachable through any current branch, tag or ref. A fresh clone over
Git's transfer protocol was verified to contain none of the 373 removed blobs.
Publish cleaned branch refs, not a copy of `.git` or a private checkout mirror.
Other worktrees should be resynchronized before making future commits, so their
old indexes cannot reintroduce removed material.

Read-only GitHub inspection found the remote private, with one branch (`main`),
no releases/assets, no pull requests and no wiki.

On 2026-10-17, with the owner's approval, cleaned `main` was force-pushed using
an explicit lease against the verified original remote tip. The repository remains
private; local experimental branches were not published. No repository visibility
change, store-console edit, hosted redeployment, product retirement or refund was
performed. Rewriting the branch does not guarantee deletion of GitHub's cached or
unreachable objects; any remote caches or forks need separate handling before
public release. Published source
archives must include `third_party/`, notices, and the license/provenance files.

## Verification

- Mobile lint/typecheck, 535 unit tests, and production build pass.
- Android Kotlin/Java compilation, debug APK packaging, and a full unsigned iOS
  simulator build pass with the final synchronized assets and bundled notices.
  A physical-device camera run was not available; native hardware camera behavior
  is not certified by simulator compilation.
- Browser tests decode a real generated EAN-13 frame through ZXing, verify camera
  cleanup, permission denial/cancellation, notices, and persistence beyond 30 books.
- Updated cover-import tests pass with original fictional-cover fixtures.
- Synthetic gallery baselines were inspected and regenerated for small renderer
  differences; gallery screenshot/keyboard checks pass.
- All 20 localized production website routes pass responsive layout, image,
  canonical/language-link and language-switch checks.
- All 19 targeted quarterly-review/export cases pass across the verification runs.
  Old date-dependent fixtures now use a fixed date, PNG dimensions match the new
  SVGs, and unsupported-language fallback uses an actually unsupported language.
  Known bundled SVGs are accepted by snapshot export; arbitrary SVG/remote input
  remains disallowed. Exported PNGs match preview bytes and survive backup restore.
- The broader run found two existing failures, reproduced against unchanged
  commit `304196e` in an isolated baseline with the same cover fixtures:
  `import-review.spec.ts`'s import-history Undo button lookup, and
  `library-grid.spec.ts`'s desktop custom-shelf drag storage alert. Their existing
  tests remain enabled. They are not introduced by this cleanup or counted as
  passing checks. A touch-drag case failed once but passed the baseline and final
  smoke reruns. No unrelated drag/storage behavior was changed.
- A fresh publication clone was checked with pinned Bun 1.3.13 and frozen
  lockfiles. Mobile and website lint/typecheck and production builds pass; the
  source/provenance/notices check passes. A timing-sensitive smart-list budget
  failed once under parallel build load and passed in isolation with its original
  threshold unchanged. The final serial full suite passes all 535 tests under
  pinned Bun 1.3.13.
- Gitleaks rescanned all rewritten refs with no credentials found. Its sole
  exception is the exact local-storage namespace `wovenleaf.tbr-recommendations.v1`,
  not a token or a broad file/directory exclusion.

## Platform and licensing limits

This cleanup prepares public source; it does not bypass iOS provisioning, guarantee
browser/native feature parity, grant rights to third-party service content or
provide signing identities for forks. App IDs and App Groups remain stable for
existing installations; independent forks must configure their own identity and
operator details. Provider terms and user-supplied book rights still apply.

For new contributions, provenance records require honest authorship/permission;
a checksum alone is not proof of copyright ownership. Dependency and media
changes must be reviewed and notices regenerated before new binary distributions.
