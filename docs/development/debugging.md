# Debugging

Use a debug build with a small demo library. Export a backup before investigating
an installation containing books you care about. Uninstalling an app, clearing
site storage, and changing application IDs can remove or isolate its data.

## Browser and WebView

Run `bun run dev` from `apps/mobile`, then inspect browser Console and Network.
Reproduce with the smallest input that fails. Check the first console error,
failed request, and corresponding Vite output before changing code.

For Android, install a Debug build, connect an authorized device, and open
`chrome://inspect/#devices` in desktop Chrome. Enable **Discover USB devices**
and inspect the Wovenleaf WebView. If it is absent, check `adb devices -l`, open
the app, and confirm you installed Debug rather than a release build.

For iOS, enable **Web Inspector** under the device's Safari advanced settings.
Enable Safari's developer features on the Mac, connect/trust the device, and
select Wovenleaf's web content from Safari's **Develop** menu. Inspectability
depends on the native build and OS; use Debug. JavaScript and network inspection
covers the WebView; use native tools for reader, audio, and plugin failures.

See Android's [WebView debugging guide](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools)
for remote inspection details.

## Native logs and breakpoints

In Android Studio, run the Debug configuration and select the app in **Logcat**.
Use Java/Kotlin breakpoints in `android/app/src/main/java/com/hmrguez/wovenleaf/`.
From a terminal, replace the package if using a fork:

```sh
adb devices -l
adb shell pidof -s com.hmrguez.wovenleaf.dev
# Replace 12345 with the PID printed above; repeat after restarting the app.
adb logcat --pid=12345
```

In Xcode, use the **App** scheme, Run, the debug console, and Swift breakpoints
under `ios/App/App/`. ShareExtension and LibbyExtension are separate processes;
attach the debugger to the relevant extension when investigating its handler.
A JavaScript stack trace alone will not explain an App Group or native permission failure.

Keep crash reports, database copies, loan details, and file paths private.
Use synthetic reproductions in public issues and avoid logging imported book
content, reading history, connection codes, or credentials.

## Storage and imports

The shared repository and migration code lives in `src/storage/`. Read the
[SQLite development guide](../guides/sqlite-development.md) before changing it.
Never modify a migration that an installation may already have applied.

For a consistent SQLite copy from a disposable test installation:

```sh
# From apps/mobile; use a SQLite database copy, not a portable backup ZIP.
bun run storage:inspect -- /absolute/path/to/wovenleafSQLite.db
```

The inspector opens read-only and reports integrity, migrations, counts, and
indexes. It does not decrypt an encrypted database or read IndexedDB directly.
Use a consistent database snapshot/export; copying a live SQLite main file alone
can omit WAL transactions. For browser storage, inspect IndexedDB through the
browser's Application/Storage tools. Keep database edits out of normal debugging.

For import problems, use a minimal CSV or DRM-free fixture and check the import
preview before committing it. See [recovery](../guides/recovery.md) for restore
behavior and [original files](../guides/original-files.md) for file handling.

## Libby

Verify each boundary in order:

1. Wovenleaf's Libby integration is enabled and the intended browser is selected.
2. The companion is installed, enabled, and allowed on Libby and its embedded reader.
3. Android is paired; iOS app and extension use the same provisioned App Group.
4. Open or **reload** the visible Libby web Shelf to populate loan metadata.
5. Return to Wovenleaf and inspect connection status and books awaiting review.

An already-open reader cannot identify a loan without fresh Shelf metadata.
Visit the Shelf after browser restart or cache expiry. Native Libby progress
may take time to reach the web; test direct web reading separately. On Android,
reopen Wovenleaf after a force-stop so its local receiver can resume.

From the repository root, with mobile dependencies installed:

```sh
node apps/libby-extension/build.mjs
node apps/libby-extension/verify.mjs
node apps/libby-extension/verify-player.mjs
node apps/libby-extension/verify-reader.mjs
node apps/libby-extension/verify-local.mjs
node apps/libby-extension/verify-safari.mjs
# macOS with Xcode:
sh apps/libby-extension/verify-native.sh
```

These use synthetic fixtures; they do not establish physical-device compatibility.
See the [companion guide](../../apps/libby-extension/README.md) and
[integration evidence](../integrations/libby.md) for device checks and limitations.

## Common failures

| Symptom | Check |
| --- | --- |
| Installed app shows old UI | Run `bun run cap:sync` and rebuild/reinstall; Vite alone updates the browser. |
| Android SDK or Java build error | SDK 36, JDK 21, Gradle JDK setting, and local SDK path; run `make doctor`. |
| Android update signature mismatch | Match the installed app's signing key or use a separate app ID. Avoid uninstalling a valuable library. |
| iOS provisioning/App Group error | Team, all three bundle IDs, all three entitlement files, and native App Group literals; see the release guide. |
| Readium missing after Capacitor sync | Reinstall dependencies, rerun `cap:sync`, then resolve Swift packages in Xcode. |
| Camera works natively but not on web | Browser permission and HTTPS/localhost; manual ISBN entry is available. |
| Browser database appears empty | Confirm the same origin and port, browser profile, and storage permissions. |
| A `.env.local` change has no effect | Restart Vite or rebuild and sync the native app; Vite values are build-time values. |

When reporting a bug, include the commit, platform/OS, build type, minimal steps,
expected and actual behavior, and sanitized logs. State whether the failure occurs
in a browser, simulator/emulator, or physical device.
