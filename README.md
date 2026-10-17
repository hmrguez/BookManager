# Wovenleaf

A quiet place for your books, reading, and listening. Wovenleaf is a local-first
React/Capacitor app for iOS, Android, and browser development, with a separate
Astro landing page and an optional Libby progress companion.

**Free, unlimited libraries.** There are no paid tiers, license keys, subscriptions,
or in-app purchases. Readers supply their own files. Online metadata lookup is
optional; no Wovenleaf account or service API key is needed.

## What it does

- Organize books into reading shelves, collections and personal tags.
- Add books manually, by ISBN scan, or through optional Open Library lookup.
- Preview and review CSV/Goodreads imports before committing changes.
- Read supported DRM-free EPUB/PDF files using native reader integrations.
- Listen to local audiobook files, save bookmarks and track progress.
- Explore reading statistics and saved quarterly review keepsakes.
- Export and restore portable backups; keep your own copies of important data.

Native and browser capabilities differ. See [community builds and installation](docs/guides/community-builds.md)
for Android APK installation without Google Play, iOS signing requirements, and
browser limitations. No prebuilt binary or hosted public web app is promised
until a release or deployment actually exists.

## Run locally

Install Bun 1.3.13, then:

```sh
cd apps/mobile
bun install --frozen-lockfile
bun run dev
```

For validation:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```

The landing website has its own package and lockfile under `apps/landing`:
install with `bun install --frozen-lockfile`, then `bun run dev` or `bun run build`.
Build scripts apply the committed native dependency patches and bundle the Libby
companion. Native toolchains are described in the community-build guide.

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/mobile/` | React application, SQLite repositories, native iOS/Android hosts |
| `apps/landing/` | Static Astro website and privacy/terms pages |
| `apps/libby-extension/` | Optional browser/Safari companion; users supply their own library access |
| `CONTEXT.md` | Shared domain vocabulary |
| `docs/architecture/decisions/` | Architecture and data/privacy contracts |
| `scripts/` | Public asset generation, license inventory and publication checks |
| `third_party/` | Dependency notices, exact versions and modified MPL source |

## Privacy and safety

Your library and imported book files live on your device. Camera recognition uses
ZXing on Android/web and system camera APIs on iOS. Camera frames are not uploaded
or retained. An ISBN or search query is sent to Open Library only when using online
lookup; remote covers and optional integrations contact their respective providers.
User books and provider cover images are not distributed with the source release.
The browser uses browser storage and its quotas; it is not a substitute for backups.

Do not commit private libraries, signing material, credentials or real-user
screenshots. See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[CONTRIBUTING.md](CONTRIBUTING.md) for public issues, builds and contributions.
CI checks code, asset provenance and secrets in reachable history.

## License and attribution

Original code and project-owned artwork: [MIT](LICENSE), Copyright (c) 2026
Hector Rodriguez. Copies or substantial portions must retain the copyright and
permission notices. MIT does not require visible credit in your app interface.
Clearly identify independent forks; the name Wovenleaf does not imply endorsement.

Third-party software keeps its own licenses. Read [third_party/README.md](third_party/README.md)
and the bundled [notices](third_party/NOTICES.txt). Modified Capgo share-target
source is provided under MPL-2.0, fonts retain OFL terms, and JSZip uses its MIT
option. [ASSET_LICENSES.json](ASSET_LICENSES.json) records media provenance and hashes.
No license here grants rights to other people's books, cover artwork or trademarks.

The [public-readiness remediation record](docs/audits/public-readiness-remediation-2026-10-17.md)
documents replacements, checks, history cleanup and remaining platform limitations.
