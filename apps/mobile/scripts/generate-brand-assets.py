#!/usr/bin/env python3
"""Generate and validate Wovenleaf platform artwork from the approved mark."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / "apps/mobile"
IOS_ASSETS = MOBILE / "ios/App/App/Assets.xcassets"
IOS_ICON = IOS_ASSETS / "AppIcon.appiconset"
IOS_SPLASH = IOS_ASSETS / "Splash.imageset"
ANDROID_RES = MOBILE / "android/app/src/main/res"
PUBLIC = MOBILE / "public"

COLORS = {
    "forest": "#173429",
    "cream": "#F3E3CC",
    "terracotta": "#C95F39",
    "burnt": "#A64627",
    "ink": "#272A27",
    "paper": "#F5F0E7",
}
RGB = {name: tuple(bytes.fromhex(value[1:])) for name, value in COLORS.items()}
SOURCE_PALETTE = np.array((RGB["forest"], RGB["cream"], RGB["terracotta"], RGB["burnt"]), dtype=np.int32)

ANDROID_DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
ANDROID_SPLASHES = {
    "drawable/splash.png": (480, 320),
    "drawable-land-mdpi/splash.png": (480, 320),
    "drawable-land-hdpi/splash.png": (800, 480),
    "drawable-land-xhdpi/splash.png": (1280, 720),
    "drawable-land-xxhdpi/splash.png": (1600, 960),
    "drawable-land-xxxhdpi/splash.png": (1920, 1280),
    "drawable-port-mdpi/splash.png": (320, 480),
    "drawable-port-hdpi/splash.png": (480, 800),
    "drawable-port-xhdpi/splash.png": (720, 1280),
    "drawable-port-xxhdpi/splash.png": (960, 1600),
    "drawable-port-xxxhdpi/splash.png": (1280, 1920),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-png",
        type=Path,
        default=ROOT / "branding/source/wovenleaf-mark-color-2048px.png",
        help="Approved transparent PNG master.",
    )
    parser.add_argument(
        "--source-svg",
        type=Path,
        default=ROOT / "branding/source/wovenleaf-mark-color.svg",
        help="Approved path-only SVG master.",
    )
    parser.add_argument(
        "--local-output",
        type=Path,
        default=ROOT / "branding/final/platform",
        help="Local-only store sources, previews, manifest, and QA.",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8", newline="\n")


def write_json(path: Path, value: object) -> None:
    write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, compress_level=9)


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("Approved mark has no visible pixels")
    return rgba.crop(bbox)


def fitted_layer(mark: Image.Image, size: tuple[int, int], visible_fraction: float) -> Image.Image:
    cropped = alpha_crop(mark)
    max_width = max(1, round(size[0] * visible_fraction))
    max_height = max(1, round(size[1] * visible_fraction))
    scale = min(max_width / cropped.width, max_height / cropped.height)
    resized = cropped.resize((max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.alpha_composite(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    return layer


def solid_background(size: tuple[int, int], color: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", size, color)


def compose(mark: Image.Image, size: tuple[int, int], background: tuple[int, int, int], visible_fraction: float) -> Image.Image:
    result = solid_background(size, background)
    layer = fitted_layer(mark, size, visible_fraction)
    result.paste(layer, (0, 0), layer)
    return result


def palette_variant(image: Image.Image, variant: str) -> Image.Image:
    data = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    pixels = data[..., :3].astype(np.int32)
    distances = np.sum((pixels[..., None, :] - SOURCE_PALETTE[None, None, :, :]) ** 2, axis=3)
    nearest = np.argmin(distances, axis=2)
    output = np.zeros_like(data)
    if variant == "reversed":
        replacements = np.array((RGB["cream"], RGB["forest"], RGB["terracotta"], RGB["burnt"]), dtype=np.uint8)
        output[..., :3] = replacements[nearest]
        output[..., 3] = data[..., 3]
    elif variant == "monochrome":
        output[..., :3] = RGB["ink"]
        output[..., 3] = np.where(nearest == 1, 0, data[..., 3])
    else:
        raise ValueError(f"Unknown palette variant: {variant}")
    output[data[..., 3] == 0, :3] = 0
    return Image.fromarray(output)


def circular_icon(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    mask = Image.new("L", rgba.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, rgba.width - 1, rgba.height - 1), fill=255)
    rgba.putalpha(mask)
    return rgba


def splash(mark: Image.Image, size: tuple[int, int]) -> Image.Image:
    return compose(mark, size, RGB["paper"], 0.29)


def tinted_source(mark: Image.Image, size: int) -> Image.Image:
    layer = fitted_layer(palette_variant(mark, "monochrome"), (size, size), 0.68)
    gray = ImageOps.grayscale(layer)
    result = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    result.paste(Image.merge("RGB", (gray, gray, gray)), (0, 0), layer.getchannel("A"))
    return result


def generate_ios(mark: Image.Image, reversed_mark: Image.Image, local_output: Path) -> list[Path]:
    paths: list[Path] = []
    any_icon = compose(mark, (1024, 1024), RGB["paper"], 0.68)
    dark_icon = compose(reversed_mark, (1024, 1024), RGB["forest"], 0.68)
    tinted_icon = tinted_source(mark, 1024)
    for filename, image in (
        ("AppIcon-512@2x.png", any_icon),
        ("AppIcon-512@2x-dark.png", dark_icon),
        ("AppIcon-512@2x-tinted.png", tinted_icon),
    ):
        path = IOS_ICON / filename
        save_png(image, path)
        paths.append(path)
    write_json(
        IOS_ICON / "Contents.json",
        {
            "images": [
                {"filename": "AppIcon-512@2x.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"},
                {
                    "appearances": [{"appearance": "luminosity", "value": "dark"}],
                    "filename": "AppIcon-512@2x-dark.png",
                    "idiom": "universal",
                    "platform": "ios",
                    "size": "1024x1024",
                },
                {
                    "appearances": [{"appearance": "luminosity", "value": "tinted"}],
                    "filename": "AppIcon-512@2x-tinted.png",
                    "idiom": "universal",
                    "platform": "ios",
                    "size": "1024x1024",
                },
            ],
            "info": {"author": "xcode", "version": 1},
        },
    )
    paths.append(IOS_ICON / "Contents.json")

    splash_image = splash(mark, (2732, 2732))
    for filename in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        path = IOS_SPLASH / filename
        save_png(splash_image, path)
        paths.append(path)

    store = local_output / "store"
    save_png(any_icon, store / "app-store-icon-1024.png")
    save_png(splash_image, store / "ios-splash-source-2732.png")
    return paths


def generate_android(mark: Image.Image, monochrome_mark: Image.Image, local_output: Path) -> list[Path]:
    paths: list[Path] = []
    for density, scale in ANDROID_DENSITIES.items():
        launcher_size = round(48 * scale)
        adaptive_size = round(108 * scale)
        directory = ANDROID_RES / f"mipmap-{density}"

        legacy = compose(mark, (launcher_size, launcher_size), RGB["cream"], 0.66)
        foreground = fitted_layer(mark, (adaptive_size, adaptive_size), 62 / 108)
        monochrome = fitted_layer(monochrome_mark, (adaptive_size, adaptive_size), 62 / 108)
        round_icon = circular_icon(legacy)
        for filename, image in (
            ("ic_launcher.png", legacy),
            ("ic_launcher_round.png", round_icon),
            ("ic_launcher_foreground.png", foreground),
            ("ic_launcher_monochrome.png", monochrome),
        ):
            path = directory / filename
            save_png(image, path)
            paths.append(path)

        splash_icon = fitted_layer(mark, (round(288 * scale), round(288 * scale)), 0.58)
        splash_icon_path = ANDROID_RES / f"drawable-{density}/splash_icon.png"
        save_png(splash_icon, splash_icon_path)
        paths.append(splash_icon_path)

    for relative, size in ANDROID_SPLASHES.items():
        path = ANDROID_RES / relative
        save_png(splash(mark, size), path)
        paths.append(path)

    stale_nodpi = ANDROID_RES / "drawable-nodpi/splash_icon.png"
    if stale_nodpi.exists():
        stale_nodpi.unlink()

    store = local_output / "store"
    play_icon = compose(mark, (512, 512), RGB["cream"], 0.68)
    save_png(play_icon, store / "google-play-icon-512.png")
    save_png(fitted_layer(mark, (432, 432), 62 / 108), store / "android-adaptive-foreground-432.png")
    save_png(fitted_layer(monochrome_mark, (432, 432), 62 / 108), store / "android-themed-monochrome-432.png")
    return paths


def generate_web(mark: Image.Image, source_svg: Path) -> list[Path]:
    paths: list[Path] = []
    shutil.copyfile(source_svg, PUBLIC / "favicon.svg")
    paths.append(PUBLIC / "favicon.svg")

    favicon_frames: list[Image.Image] = []
    for size in (16, 32, 48):
        frame = compose(mark, (size, size), RGB["paper"], 0.72)
        save_png(frame, PUBLIC / f"favicon-{size}.png")
        paths.append(PUBLIC / f"favicon-{size}.png")
        favicon_frames.append(frame)
    favicon_frames[-1].save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    paths.append(PUBLIC / "favicon.ico")

    for filename, size, fraction in (
        ("apple-touch-icon.png", 180, 0.68),
        ("pwa-icon-192.png", 192, 0.68),
        ("pwa-icon-512.png", 512, 0.68),
        ("pwa-maskable-192.png", 192, 0.58),
        ("pwa-maskable-512.png", 512, 0.58),
    ):
        path = PUBLIC / filename
        save_png(compose(mark, (size, size), RGB["paper"], fraction), path)
        paths.append(path)

    manifest = {
        "name": "Wovenleaf",
        "short_name": "Wovenleaf",
        "description": "A private, local-first book tracker for reading without the noise.",
        "id": "/",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": COLORS["paper"],
        "theme_color": COLORS["forest"],
        "icons": [
            {"src": "/pwa-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/pwa-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/pwa-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/pwa-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    write_json(PUBLIC / "manifest.webmanifest", manifest)
    paths.append(PUBLIC / "manifest.webmanifest")
    return paths


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * radius), fill=255)
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def squircle_mask(size: int, exponent: float = 4.4) -> Image.Image:
    axis = np.linspace(-1, 1, size)
    xx, yy = np.meshgrid(axis, axis)
    inside = (np.abs(xx) ** exponent + np.abs(yy) ** exponent) <= 1
    return Image.fromarray(np.where(inside, 255, 0).astype(np.uint8), mode="L")


def teardrop_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, round(size * 0.1), round(size * 0.9), size - 1), radius=round(size * 0.45), fill=255)
    draw.polygon(((round(size * 0.55), 0), (size - 1, 0), (size - 1, round(size * 0.45))), fill=255)
    return mask


def label_font(size: int) -> ImageFont.ImageFont:
    for path in (Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"), Path("/System/Library/Fonts/Helvetica.ttc")):
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def apply_mask(image: Image.Image, mask: Image.Image) -> Image.Image:
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


def centered_label(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], value: str, font: ImageFont.ImageFont) -> None:
    bounds = draw.textbbox((0, 0), value, font=font)
    x = box[0] + (box[2] - box[0] - (bounds[2] - bounds[0])) / 2
    y = box[1] + (box[3] - box[1] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    draw.text((x, y), value, font=font, fill=COLORS["forest"])


def generate_previews(mark: Image.Image, reversed_mark: Image.Image, monochrome_mark: Image.Image, local_output: Path) -> list[Path]:
    qa = local_output / "qa"
    qa.mkdir(parents=True, exist_ok=True)
    cell, header = 220, 54
    labels = ("IOS ANY", "IOS DARK", "IOS TINTED", "ANDROID CIRCLE", "ANDROID SQUIRCLE", "ANDROID ROUND", "ANDROID TEARDROP", "ANDROID THEMED")
    canvas = Image.new("RGB", (cell * len(labels), cell + header), (232, 226, 216))
    draw = ImageDraw.Draw(canvas)
    font = label_font(13)

    any_icon = compose(mark, (180, 180), RGB["paper"], 0.68)
    dark_icon = compose(reversed_mark, (180, 180), RGB["forest"], 0.68)
    tint_mask = fitted_layer(monochrome_mark, (180, 180), 0.68).getchannel("A")
    tinted = Image.new("RGBA", (180, 180), (205, 198, 214, 255))
    tinted_shape = Image.new("RGBA", (180, 180), (79, 59, 96, 0)); tinted_shape.putalpha(tint_mask)
    tinted.alpha_composite(tinted_shape)
    adaptive = compose(mark, (180, 180), RGB["cream"], 62 / 108)
    themed_mask = fitted_layer(monochrome_mark, (180, 180), 62 / 108).getchannel("A")
    themed = Image.new("RGBA", (180, 180), (220, 229, 217, 255))
    themed_shape = Image.new("RGBA", (180, 180), (*RGB["forest"], 0)); themed_shape.putalpha(themed_mask)
    themed.alpha_composite(themed_shape)
    previews = (
        apply_mask(any_icon, rounded_mask(180, 0.22)),
        apply_mask(dark_icon, rounded_mask(180, 0.22)),
        apply_mask(tinted, rounded_mask(180, 0.22)),
        apply_mask(adaptive, circle_mask(180)),
        apply_mask(adaptive, squircle_mask(180)),
        apply_mask(adaptive, rounded_mask(180, 0.30)),
        apply_mask(adaptive, teardrop_mask(180)),
        apply_mask(themed, squircle_mask(180)),
    )
    for index, (label, preview) in enumerate(zip(labels, previews, strict=True)):
        left = index * cell
        centered_label(draw, (left, 0, left + cell, header), label, font)
        canvas.paste(preview, (left + 20, header + 20), preview)
    mask_path = qa / "platform-mask-appearance-preview.png"
    save_png(canvas, mask_path)

    safe = Image.new("RGB", (640, 640), RGB["paper"])
    safe_draw = ImageDraw.Draw(safe)
    layer = fitted_layer(mark, (432, 432), 62 / 108)
    safe.paste(layer, (104, 104), layer)
    outer = (104, 104, 536, 536)
    inset = round(18 / 108 * 432)
    safe_draw.rectangle(outer, outline=COLORS["forest"], width=2)
    safe_draw.rectangle((outer[0] + inset, outer[1] + inset, outer[2] - inset, outer[3] - inset), outline=COLORS["terracotta"], width=3)
    safe_draw.text((104, 62), "ANDROID 108 DP LAYER / 66 DP MASK-SAFE CORE", font=font, fill=COLORS["forest"])
    safe_path = qa / "android-adaptive-safe-zone.png"
    save_png(safe, safe_path)

    splash_canvas = Image.new("RGB", (1240, 620), RGB["ink"])
    ios = splash(mark, (310, 550)); android = splash(mark, (310, 550)); landscape = splash(mark, (550, 310))
    splash_canvas.paste(ios, (30, 35)); splash_canvas.paste(android, (360, 35)); splash_canvas.paste(landscape, (690, 155))
    splash_path = qa / "splash-layout-preview.png"
    save_png(splash_canvas, splash_path)
    return [mask_path, safe_path, splash_path]


def alpha_bbox_fraction(path: Path) -> tuple[float, float, float, float]:
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return (0.0, 0.0, 0.0, 0.0)
    return tuple(round(value / alpha.width, 4) for value in bbox)  # type: ignore[return-value]


def validate(source_svg: Path, generated: list[Path], local_output: Path) -> dict[str, object]:
    svg_root = ET.parse(source_svg).getroot()
    svg_tags = {node.tag.rsplit("}", 1)[-1] for node in svg_root.iter()}
    expected = {
        IOS_ICON / "AppIcon-512@2x.png": (1024, 1024),
        IOS_ICON / "AppIcon-512@2x-dark.png": (1024, 1024),
        IOS_ICON / "AppIcon-512@2x-tinted.png": (1024, 1024),
        IOS_SPLASH / "splash-2732x2732.png": (2732, 2732),
        PUBLIC / "apple-touch-icon.png": (180, 180),
        PUBLIC / "pwa-icon-192.png": (192, 192),
        PUBLIC / "pwa-icon-512.png": (512, 512),
        PUBLIC / "pwa-maskable-192.png": (192, 192),
        PUBLIC / "pwa-maskable-512.png": (512, 512),
        ANDROID_RES / "drawable-mdpi/splash_icon.png": (288, 288),
        local_output / "store/app-store-icon-1024.png": (1024, 1024),
        local_output / "store/google-play-icon-512.png": (512, 512),
    }
    dimensions: dict[str, dict[str, object]] = {}
    for path, required in expected.items():
        with Image.open(path) as image:
            actual = image.size
        dimensions[str(path.relative_to(ROOT))] = {"required": list(required), "actual": list(actual), "pass": actual == required}

    foreground = ANDROID_RES / "mipmap-mdpi/ic_launcher_foreground.png"
    bbox = alpha_bbox_fraction(foreground)
    android_safe = bbox[0] >= 18 / 108 and bbox[1] >= 18 / 108 and bbox[2] <= 90 / 108 and bbox[3] <= 90 / 108
    manifest = json.loads((PUBLIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    icon_sizes = {item["sizes"] for item in manifest["icons"]}
    android_xml = (
        ANDROID_RES / "mipmap-anydpi-v33/ic_launcher.xml",
        ANDROID_RES / "mipmap-anydpi-v33/ic_launcher_round.xml",
    )
    xml_ok = all(any(node.tag == "monochrome" for node in ET.parse(path).getroot()) for path in android_xml)
    tests = {
        "source_is_text_free": {"pass": "text" not in svg_tags and "image" not in svg_tags, "svg_tags": sorted(svg_tags)},
        "required_dimensions": {"pass": all(item["pass"] for item in dimensions.values()), "results": dimensions},
        "android_adaptive_safe_zone": {"pass": android_safe, "alpha_bbox_fraction": bbox, "required_core": [round(18 / 108, 4), round(90 / 108, 4)]},
        "android_monochrome_api33": {"pass": xml_ok, "files": [str(path.relative_to(ROOT)) for path in android_xml]},
        "pwa_manifest": {"pass": {"192x192", "512x512"}.issubset(icon_sizes), "icon_sizes": sorted(icon_sizes)},
        "generated_files_exist": {"pass": all(path.exists() for path in generated), "count": len(generated)},
    }
    report = {
        "identity": "Wovenleaf",
        "issue": "QUI-11",
        "version": "1.0",
        "generated": "2026-08-25",
        "tests": tests,
        "overall_pass": all(bool(test["pass"]) for test in tests.values()),
    }
    write_json(local_output / "qa/platform-qa-report.json", report)
    return report


def write_manifest(paths: list[Path], source_png: Path, source_svg: Path, local_output: Path) -> None:
    unique = sorted(set(paths), key=lambda path: str(path))
    write_json(
        local_output / "platform-manifest.json",
        {
            "identity": "Wovenleaf",
            "issue": "QUI-11",
            "source": {"png_sha256": sha256(source_png), "svg_sha256": sha256(source_svg)},
            "files": [
                {"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size, "sha256": sha256(path)}
                for path in unique
            ],
        },
    )


def main() -> int:
    args = parse_args()
    source_png = args.source_png.resolve()
    source_svg = args.source_svg.resolve()
    local_output = args.local_output.resolve()
    if not source_png.is_file() or not source_svg.is_file():
        raise SystemExit("Approved branding sources are missing. Build QUI-6 locally before regenerating platform assets.")
    local_output.mkdir(parents=True, exist_ok=True)
    mark = Image.open(source_png).convert("RGBA")
    reversed_mark = palette_variant(mark, "reversed")
    monochrome_mark = palette_variant(mark, "monochrome")

    generated: list[Path] = []
    generated.extend(generate_ios(mark, reversed_mark, local_output))
    generated.extend(generate_android(mark, monochrome_mark, local_output))
    generated.extend(generate_web(mark, source_svg))
    generated.extend(generate_previews(mark, reversed_mark, monochrome_mark, local_output))
    report = validate(source_svg, generated, local_output)
    generated.extend((local_output / "qa/platform-qa-report.json",))
    write_manifest(generated, source_png, source_svg, local_output)
    if not report["overall_pass"]:
        raise SystemExit("Platform asset QA failed; inspect branding/final/platform/qa/platform-qa-report.json")
    print(f"Generated and validated {len(generated)} Wovenleaf platform assets; QA PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
