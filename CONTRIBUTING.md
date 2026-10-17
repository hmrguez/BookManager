# Contributing to Wovenleaf

Wovenleaf is a local-first library, reader and audiobook player. Its original
code and original artwork are MIT-licensed. Contributions are made under that
license; third-party covered files retain their existing licenses.

Use public GitHub issues and pull requests. Access to the maintainer's Linear
workspace or personal agent skills is not required. Small fixes may go directly
to a pull request; discuss large changes in an issue first. Never include real
library exports, private reading histories, account credentials, or unlicensed
book content in reports, tests or screenshots.

See the [developer guides](docs/development/README.md) for build, debugging, signing,
and personal release workflows.

## Build and test

Install Bun 1.3.13 (see `.bun-version`), then from `apps/mobile` run:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run dev
```

For the static website, run `bun install --frozen-lockfile`, `bun run lint`,
`bun run typecheck`, and `bun run build` from `apps/landing`.
See [community builds](docs/guides/community-builds.md) for Android/iOS toolchains,
signing, installation and web limitations. Bun applies the committed dependency
patches during installation; do not edit `node_modules` manually.

## Review expectations

Keep the existing quiet, paper-inspired UI and accessibility behavior. Keep
complexity behind clear interfaces, validate imported content at boundaries,
and preserve private user data. Changes to persistence need meaningful tests
and must respect the immutable migration history. Read `CONTEXT.md` and relevant
ADRs under `docs/architecture/decisions/` before changing domain behavior.

Run lint and typecheck before sending changes. Add tests for meaningful behavior
changes and keep existing tests passing. Use fictional fixtures and original or
explicitly licensed media. Record every new tracked image/audio asset and its
hash in `ASSET_LICENSES.json`; `python3 scripts/check-public-repo.py` checks it.
Dependency updates must regenerate the notices and inventory as described in
`scripts/licenses/README.md`. Never add proprietary SDKs to runtime graphs.
