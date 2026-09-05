# Wovenleaf landing

Astro landing page for the Capacitor app: a fast, simple book tracker, EPUB reader,
and audiobook player. The three campaign panels are integrated as local assets,
with full-size views linked from each feature section.

## Run

```sh
bun install
bun run dev
```

The landing page runs at `http://127.0.0.1:4321`. Start the mobile web app separately
with `cd ../mobile && bun run dev --host 127.0.0.1` to use the development CTA.

## Check and build

```sh
bun run lint
bun run typecheck
bun run build
```

Output is static HTML and assets in `dist`. Production links default to the feature
section until a real app destination is supplied. Set `PUBLIC_APP_URL` at build time
to the approved app/download URL. No invented store links, signups, analytics, or
remote image requests are included.

## Campaign

[Canva: Track, read, listen](https://www.canva.com/design/DAHUU_EqUyQ/vsVhApN-YGWeehPXHvpRvQ/edit)
contains three 1080 × 1350 pages. Canva pages use the finished PNG artwork as page
backgrounds; text and layout remain editable in the versioned source generator.

`bun run campaign` regenerates the SVG and PNG artwork from the original mobile
captures and copies the PNGs into `public/marketing`. See
`../../branding/marketing/README.md` for capture provenance and limitations.
