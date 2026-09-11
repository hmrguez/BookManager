# Google Play asset package

The `export/` directory is the self-contained release asset folder, also copied to
`~/Documents/Wovenleaf-Google-Play`. Start with `export/00-START-HERE.md` for the
complete landing asset index, dimensions, provenance, upload mapping, and limitations.

`feature-graphic-1024x500.png` is the final Google Play promotional banner. The exact
built-in image generation prompt is saved in `feature-graphic-prompt.txt`.

Rebuild the package from the current source assets with:

```sh
bun branding/google-play/package-assets.mjs
```

The script uses the landing app’s installed `sharp` dependency. Generated brand
variants under `branding/final` must already exist; rebuild those with the commands
in `branding/README.md` and the root README if needed. Original screenshot and logo
copies are checked by SHA-256; the store icon’s decoded pixels are compared with
its source; final Play image dimensions, channels, and icon size are checked.

Requirements checked on 11 September 2026:
https://support.google.com/googleplay/android-developer/answer/9866151?hl=en
