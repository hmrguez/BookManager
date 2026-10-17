# Regenerate third-party notices

Install both applications from their frozen Bun lockfiles and resolve/build iOS
packages so their exact pinned source checkouts exist. Then export Android's
release runtime graph (the temporary file contains local build paths only if
added by a future exporter; do not commit temporary inventories):

```sh
cd apps/mobile/android
WOVENLEAF_ANDROID_INVENTORY=/tmp/wovenleaf-android-inventory.json \
  ./gradlew -I ../../../scripts/licenses/android-inventory.gradle :app:publicDependencyInventory
cd ../../..
python3 scripts/licenses/generate.py \
  --android /tmp/wovenleaf-android-inventory.json \
  --swift-checkouts /path/to/DerivedData/SourcePackages/checkouts
```

`third_party/metadata/maven/` retains the versioned public POM metadata for the
resolved modules. Obtain new POMs from Google Maven for AndroidX and Maven Central
for other modules, or your resolved Gradle cache; never guess their license.
The generator fails on unknown/missing licenses or mismatched Swift revisions.
It includes installed JavaScript runtime dependencies, Android runtime modules,
Swift package licenses, font licenses and available native artifact NOTICE files.
Static-site compiler/dev tools are not shipped with the static site and are not
part of its redistributed runtime. The checked-in Gradle wrapper's license/notice
are provided separately. The inventory does not include Apple/Android system SDKs.

Common license texts in `third_party/licenses/` come from SPDX's license-list-data
repository; actual upstream notices are retained per package in `inventory.json`.
Review license changes, particularly copyleft/source obligations. The generator
is inventory tooling, not an automated legal determination of every dependency.
After dependency changes, also refresh `third_party/capacitor-share-target/` if
that patched package changes, retain its license, exact upstream revision and
patch, and include preferred source plus build configuration.
