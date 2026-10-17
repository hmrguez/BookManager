# Third-party software

The root MIT license applies to original Wovenleaf code, not to this directory
or third-party dependencies. `inventory.json` records resolved JavaScript/build,
Android release, and Swift package versions; `NOTICES.txt` includes upstream
notices and license texts and is bundled into both applications.

`capacitor-share-target/` is the installed **8.0.49** package, including the
Wovenleaf native patch, published source maps, restored TypeScript sources, and
its MPL-2.0 license. Native source is in `android/src/` and `ios/Sources/`.
These covered source files and modifications remain **MPL-2.0**, not MIT.
Upstream: https://github.com/Cap-go/capacitor-share-target .
The source is also available at
https://github.com/hmrguez/BookManager/tree/main/third_party/capacitor-share-target .
Ship this directory with every release source archive. Recipients can build the
native modules through the ordinary Capacitor build; the exact distributed JS
and its source maps are included. `wovenleaf.patch` records the changes from the
npm package, which is pinned in the Bun lockfile. Frozen `bun install` applies
the same patch to the build dependency.

Regenerate the inventory and notices after changing dependencies; see
`scripts/licenses/README.md`. License text files here retain their own terms.
