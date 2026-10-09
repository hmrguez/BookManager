# Wovenleaf landing

Astro landing page for the Capacitor app: a fast, simple book tracker, EPUB reader,
and audiobook player. Marketing headings and feature descriptions are semantic HTML. Each feature
section uses an original mobile screenshot, with a link to its full-size view.
Screenshots in `public/screenshots` preserve their original proportions; the
text-bearing campaign artwork is reserved for social media.

## Run

```sh
bun install
bun run dev
```

The landing page runs at `http://127.0.0.1:4321`. Wovenleaf is a mobile app; the landing page does not link to a web app.

The footer links to `/privacy/` and `/terms/`. Both are static, directly accessible
legal pages with a shared layout and section navigation. Public operator details
and the effective date live in `src/legal.ts`. See
`../../docs/guides/privacy-review.md` for the source review behind the disclosures.
Production builds reject missing operator details so draft placeholders cannot be published.

## Check and build

```sh
bun run lint
bun run typecheck
bun run build
```

Output is static HTML and assets in `dist`. App Store and Google Play buttons are labelled “Coming soon” and temporarily link
to the store home pages. Set `PUBLIC_APP_STORE_URL` and `PUBLIC_GOOGLE_PLAY_URL`
at build time to the published listings, then update the coming-soon labels when
the app launches. No invented app listing IDs are used.

## Deploy to Vercel

Production: [wovenleaf.app](https://wovenleaf.app).
The default [wovenleaf-landing.vercel.app](https://wovenleaf-landing.vercel.app) alias is also available.
The `wovenleaf-landing` project belongs to the `hmrguezs-projects` team.

Run these commands from `apps/landing`:

```sh
bunx vercel link --yes --scope hmrguezs-projects --project wovenleaf-landing
bunx vercel deploy --prod --yes --scope hmrguezs-projects
```

`vercel.json` configures the Astro build with Bun and serves `dist`.
The app builds independently of the rest of the repository. `.vercelignore`
allows only the source, public assets, and required build configuration files.
Local Vercel settings and environment files are ignored by Git.

Deployments currently run through the CLI; automatic Git deployments are not
configured. For a future Git import, set the project's Root Directory to
`apps/landing`.

## Campaign

[Canva: Track, read, listen](https://www.canva.com/design/DAHUU_EqUyQ/vsVhApN-YGWeehPXHvpRvQ/edit)
contains three 1080 × 1350 pages. Canva pages use the finished PNG artwork as page
backgrounds; text and layout remain editable in the versioned source generator.

`bun run campaign` regenerates the SVG and PNG artwork from the original mobile
captures and copies the PNGs into `public/marketing`. See
`../../branding/marketing/README.md` for capture provenance and limitations.

## Reading stats capture

The fourth feature shows only the mobile dashboard opening and reading rhythm graph.
`public/screenshots/{en,es,de,it,fr}/stats.png` are original browser captures at a
390 CSS-pixel phone width and 2× pixel density, using warm paper and reduced motion.
They stop just below the chart axis, before chart exploration and book lists; bottom
navigation sits outside the captured region. Each language retains its own natural
height, which is declared alongside the story in `HomePage.astro`.

The capture uses the production Stats page with the same supported sample ledger as
`apps/mobile/visual-tests/reading-stats.spec.ts`, fixed to October 9, 2026: three
completed books, 9h 50m of tracked activity, and eight active days. The sample history
is illustrative. Each image was captured after applying the corresponding app language;
chart labels and text are rendered by the app rather than composed into marketing art.
