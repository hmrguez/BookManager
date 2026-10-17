# Privacy implementation review

Updated 17 October 2026 after the open-source cleanup.

- Library data, imported content, notes and reading history stay in local storage.
- Camera scanning uses ZXing on Android/web and AVFoundation on iOS. The old
  Google ML Kit/OutSystems package and its diagnostic collection were removed.
  No camera frames are saved, uploaded or added to diagnostics.
- Open Library receives ISBNs/search queries requested by the reader; its cover
  service receives image requests. Hosting/provider retention remains governed by
  those services. The source license does not license remote cover artwork.
- Libby uses the reader's own library account in its own app/site. The optional
  companion's schema, origin checks and local pairing boundaries remain enforced.
- The website is static and includes no visitor analytics scripts. Hosting and
  security logs are controlled by the chosen host; do not claim that no network
  request or host logging exists.
- Public marketing contains fictional books and original illustrations, not
  private reading histories or screenshots of third-party book pages.

Re-check privacy disclosures after changing runtime dependencies, provider flows,
permission use, hosting, or diagnostic behavior. Website policy text is in
`apps/landing/src/components/PrivacyPage.astro`; public operator details are in
`apps/landing/src/legal.ts`. Update those details for independently operated forks.
