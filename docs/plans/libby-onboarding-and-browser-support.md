# Libby setup and browser support

Status: proposed · 2026-09-20 · QUI-54

## Goal

Deliver four-stage setup with automatic book and progress capture, without JSON downloads, imports or manual capture. Follow Wovenleaf’s minimal design; use `frontend-design` for UI changes.

## Starting point

Quetta is verified on the Pixel for ebooks and audiobooks. Safari is implemented but needs physical iPhone verification. JSON is a fallback; ZIP installation is development-only. See [current implementation](../integrations/libby.md).

## Target setup

1. **Add the companion.** Enable the bundled Safari extension or install the Android store listing, then grant site permissions.
2. **Connect Wovenleaf.** One clear consent action enables automatic capture. Investigate replacing Android’s copy/paste pairing code with an app-to-browser handoff.
3. **Connect your Libby library.** Guide Libby’s official device-linking flow; skip when already connected. Libby authorization remains separate from Wovenleaf pairing.
4. **Start reading.** Visit the Shelf once, then open a book. Confirm completion after Wovenleaf receives its title and percentage.

Browser and Libby dialogs add taps within these stages. Detect completed stages, resume across app switches, remove duplicate toggles and offer **Reconnect**. Keep JSON outside the consumer flow.

## Delivery order

### 1. Validate Safari on a physical iPhone

- Verify permissions, delivery, resume, upgrades, existing-book matching and stale-Shelf protection.
- **Done:** non-zero progress arrives automatically from both reader types without revisiting the Shelf or importing files.

### 2. Simplify setup and ship normal installation

- Build the flow with automatic status checks and recovery.
- Spike Android pairing handoff before promising code-free setup. Preserve consent and authentication; keep secrets out of URLs and logs.
- Submit the Chromium store package; replace ZIP instructions after approval. Distribute Safari through Wovenleaf.
- **Done:** fresh Safari and Quetta installations receive their first book without developer tools or progress files.

### 3. Add Firefox on Android

- Reuse capture logic; adapt the manifest, background execution and Chromium-specific connection-origin handling.
- Verify delivery, restart/reconnect, upgrades and browser switching; publish through Mozilla’s catalog.
- **Done:** both formats pass on a physical Android device. Firefox iOS is excluded.

### 4. Validate usability and release readiness

- Test setup with five unfamiliar users without coaching; record completion time and obstacles.
- Verify interrupted setup, delivery retries and preservation of books/links.
- Run extension/native tests, `bun run lint` and `bun run typecheck`; document physical-device coverage.

## Browser priorities and reach

Prioritize **Safari → Quetta onboarding → Firefox Android**. Chromium does not guarantee mobile extension support. Brave’s [Android extension issue](https://github.com/brave/brave-browser/issues/4493) remains open despite contradictory website wording; verify before promising support. Follow [Firefox Android requirements](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

Safari represents 25.87% of [worldwide mobile traffic](https://gs.statcounter.com/browser-market-share/mobile/worldwide) and 52.84% in the [US](https://gs.statcounter.com/browser-market-share/mobile/united-states-of-america), August 2026. Traffic share does not predict paying users; measure setup completion and continued web reading.

## Boundaries

Web reading remains the MVP. Native Libby tracking, an embedded Libby WebView, desktop-to-phone delivery and guaranteed native/web synchronization are excluded. Store approval, a physical iPhone and successful pairing-handoff verification are delivery dependencies.
