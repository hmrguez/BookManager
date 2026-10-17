# Developer guide

| Guide | Covers |
| --- | --- |
| [Build and run](building.md) | Toolchains, browser development, Android and iOS builds, tests |
| [Debugging](debugging.md) | WebView inspection, native logs, storage, Libby, common failures |
| [Signing and releases](releasing.md) | Personal installs, app identifiers, signed APKs/AABs, iOS archives/IPAs, release checks |

Start with [Build and run](building.md). For a shorter installation walkthrough,
see [community builds](../guides/community-builds.md).

The mobile app and Astro website have separate packages and lockfiles. Run package
commands from the relevant app directory; there is no root `package.json`.
Source conventions are in [CONTRIBUTING.md](../../CONTRIBUTING.md), shared terminology
in [CONTEXT.md](../../CONTEXT.md), and design decisions in
[architecture/decisions](../architecture/decisions/).
