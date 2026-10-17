# Final publication check

17 October 2026. The repository remains private because the remote-history
publication boundary has not passed.

## Source and published refs

- Gitleaks 8.24.3 reports no secrets across all reachable local refs and a fresh
  GitHub mirror clone (208 non-empty commits scanned). The only configured
  exception remains the exact local-storage namespace documented in
  `.gitleaks.toml`.
- An independent scan of 2,399 reachable text blobs found no private-key,
  AWS/GitHub/Google/Stripe/Slack credential patterns.
- All 373 previously removed private/media blobs are absent from the reachable
  history, both locally and in the fresh remote clone. Local experimental
  branches were inspected but are not being pushed.
- Sensitive filename inspection of reachable history found only the intentional
  `.env.development` and `.env.example` files. These contain development feature
  flags and empty/example listing configuration, not credentials. No signing
  keys, credential exports, local databases, private capture directories,
  archives, IDE settings, or local release staging files are tracked.
- The public-source checker passes for 97 licensed assets, 192 inventoried
  dependencies, matching notices, and the modified MPL component source.
- GitHub has one published branch, the `v1.10.2` release tag, and no pull requests.
  The release contains only the signed APK, AAB, IPA, and checksums. Signing keys,
  private archives, export logs, and recovery backups have not been attached.

These checks cover reachable source, filenames, and recorded media provenance;
secret scanning does not independently inspect every image's pixels.

## Publication blocker: retained GitHub objects

The pre-cleanup commit is still retrievable from GitHub by its old identifier.
Its tree contains 273 blobs from the previously removed private/media set, and a
sample removed marketing image remains downloadable through GitHub's blob API.
A clean clone does not include these objects, but changing visibility could expose
the retained objects to anyone who knows their identifiers.

Keep the repository private until the retained data is removed and old-object
access is checked again. Another force push does not purge these server-side
objects. GitHub documents contacting Support for eligible sensitive-data cache
removal and server garbage collection; Support determines eligibility and does
not remove ordinary non-sensitive data. A fresh public repository containing only
cleaned history is an alternative requiring an explicit repository migration
choice. Do not delete or replace this repository as an automatic workaround.

Reference: [GitHub: fully removing data after rewriting history](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#fully-removing-the-data-from-github).
