#!/usr/bin/env python3
"""Build the Wovenleaf identity package from the approved vectorized mark.

The canonical SVG, PDF, and 2048 px PNG in branding/source are immutable inputs.
This script generates variants, deterministic PNG exports, QA evidence, and the
mini-guide without redrawing or replacing the approved artwork.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont as FontToolsTTFont
from fontTools.varLib.instancer import instantiateVariableFont
from pypdf import PdfReader
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as ReportLabTTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"
FINAL = BRANDING / "final"
SOURCE = BRANDING / "source"
PNG_DIR = FINAL / "png"
QA_DIR = FINAL / "qa"
WORK = BRANDING / ".work" / "build"

SOURCE_SVG = SOURCE / "wovenleaf-mark-color.svg"
SOURCE_PDF = SOURCE / "wovenleaf-identity-vector-master.pdf"
SOURCE_PNG = SOURCE / "wovenleaf-mark-color-2048px.png"

SOURCE_HASHES = {
    SOURCE_SVG.name: "a05fa8c1e28f41f85c32aeb26482a00f17de2cf21ab34ca9e7e48f977c3a1a6c",
    SOURCE_PDF.name: "ec3ec21c4a8aa6c58b1de0c966bb26f853a174e1159221787524fd249aaf6e96",
    SOURCE_PNG.name: "a8cab93a132437c710e6c24757247f2e71e7a2ee448440fca03410b32441e260",
}

COLORS = {
    "forest": "#173429",
    "cream": "#F3E3CC",
    "terracotta": "#C95F39",
    "burnt": "#A64627",
    "ink": "#272A27",
    "paper": "#F5F0E7",
    "mist": "#DED8CC",
    "white": "#FFFFFF",
}
RGB = {name: tuple(bytes.fromhex(value.removeprefix("#"))) for name, value in COLORS.items()}
SIZES = (16, 24, 32, 64, 256, 1024)
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def ensure_directories() -> None:
    for directory in (PNG_DIR, QA_DIR, WORK):
        directory.mkdir(parents=True, exist_ok=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_canonical_sources() -> None:
    for path, expected in ((path, SOURCE_HASHES[path.name]) for path in (SOURCE_SVG, SOURCE_PDF, SOURCE_PNG)):
        actual = sha256(path)
        if actual != expected:
            raise RuntimeError(f"Canonical source changed: {path.name} ({actual})")


def svg_paths(root: ET.Element) -> list[ET.Element]:
    return [node for node in root if node.tag == f"{{{SVG_NS}}}path"]


def clone_svg() -> ET.Element:
    root = ET.parse(SOURCE_SVG).getroot()
    clone = ET.fromstring(ET.tostring(root, encoding="unicode"))
    clone.set("viewBox", "0 0 3000 3000")
    clone.set("width", "3000")
    clone.set("height", "3000")
    return clone


def add_svg_title(root: ET.Element, title: str) -> None:
    root.set("role", "img")
    root.set("aria-labelledby", "title")
    title_node = ET.Element(f"{{{SVG_NS}}}title", {"id": "title"})
    title_node.text = title
    root.insert(0, title_node)


def write_svg(root: ET.Element, path: Path) -> None:
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True, short_empty_elements=True)
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        path.write_text(text + "\n", encoding="utf-8", newline="\n")


def normalized_fill(value: str | None) -> str:
    return (value or "").lower()


def write_mark_variants() -> None:
    small = clone_svg()
    for node in list(svg_paths(small)):
        if len(node.get("d", "")) < 1000:
            small.remove(node)
    add_svg_title(small, "Wovenleaf small-size page-and-leaf mark")
    write_svg(small, FINAL / "wovenleaf-mark-small.svg")

    mono = clone_svg()
    for node in list(svg_paths(mono)):
        if len(node.get("d", "")) < 1000:
            mono.remove(node)
            continue
        fill = normalized_fill(node.get("fill"))
        node.set("fill", COLORS["white"] if fill in {"#f3e3cc", "#fff", "#ffffff"} else COLORS["ink"])
    add_svg_title(mono, "Wovenleaf monochrome page-and-leaf mark")
    write_svg(mono, FINAL / "wovenleaf-mark-monochrome.svg")

    reversed_mark = clone_svg()
    for node in svg_paths(reversed_mark):
        fill = normalized_fill(node.get("fill"))
        if fill == "#173429":
            node.set("fill", COLORS["cream"])
        elif fill in {"#f3e3cc", "#fff", "#ffffff"}:
            node.set("fill", COLORS["forest"])
    add_svg_title(reversed_mark, "Wovenleaf reversed page-and-leaf mark")
    write_svg(reversed_mark, FINAL / "wovenleaf-mark-reversed.svg")


def font_source_paths() -> tuple[Path, Path]:
    package_root = ROOT / "apps" / "mobile" / "node_modules" / "@fontsource-variable"
    literata = package_root / "literata" / "files" / "literata-latin-wght-normal.woff2"
    plex = package_root / "ibm-plex-sans" / "files" / "ibm-plex-sans-latin-standard-normal.woff2"
    if not literata.exists() or not plex.exists():
        raise FileNotFoundError("Run `make install` before rebuilding brand assets; Literata or IBM Plex Sans is missing.")
    return literata, plex


def embedded_font_css() -> str:
    literata_path, plex_path = font_source_paths()
    literata = base64.b64encode(literata_path.read_bytes()).decode("ascii")
    plex = base64.b64encode(plex_path.read_bytes()).decode("ascii")
    return (
        "@font-face{font-family:'Wovenleaf Literata';"
        f"src:url(data:font/woff2;base64,{literata}) format('woff2');font-style:normal;font-weight:200 900;}}"
        "@font-face{font-family:'Wovenleaf Plex';"
        f"src:url(data:font/woff2;base64,{plex}) format('woff2');font-style:normal;font-weight:400;}}"
    )


def source_svg_inner() -> str:
    text = SOURCE_SVG.read_text(encoding="utf-8")
    return text[text.find(">") + 1 : text.rfind("</svg>")]


def lockup_svg(kind: str) -> str:
    if kind not in {"horizontal", "tagline", "descriptor"}:
        raise ValueError(kind)
    height = 260 if kind == "horizontal" else 310
    subtitle = ""
    if kind == "tagline":
        subtitle = (
            f'<text x="255" y="220" fill="{COLORS["forest"]}" font-family="Wovenleaf Plex,sans-serif" '
            'font-size="25">All your reading. One quiet place.</text>'
        )
    elif kind == "descriptor":
        subtitle = (
            f'<text x="255" y="220" fill="{COLORS["forest"]}" font-family="Wovenleaf Plex,sans-serif" '
            'font-size="20" letter-spacing="3.4">PRIVATE READING LIBRARY</text>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 1100 {height}" role="img" aria-labelledby="title">'
        f'<title id="title">Wovenleaf {kind} lockup</title><style>{embedded_font_css()}</style>'
        '<svg x="18" y="10" width="200" height="240" viewBox="608 70 1850 2840" preserveAspectRatio="xMidYMid meet">'
        f'{source_svg_inner()}</svg>'
        f'<text x="255" y="160" fill="{COLORS["forest"]}" font-family="Wovenleaf Literata,serif" '
        'font-size="103" font-weight="560" letter-spacing="-2.8" style="font-variation-settings:\'wght\' 560">wovenleaf</text>'
        f'{subtitle}</svg>\n'
    )


def write_lockups() -> None:
    for kind in ("horizontal", "tagline", "descriptor"):
        (FINAL / f"wovenleaf-lockup-{kind}.svg").write_text(lockup_svg(kind), encoding="utf-8", newline="\n")


def load_source_rgba() -> Image.Image:
    return Image.open(SOURCE_PNG).convert("RGBA")


def nearest_palette_variant(image: Image.Image, variant: str) -> Image.Image:
    data = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = data[..., 3]
    if variant not in {"mono", "reversed", "wrong"}:
        return image.copy()

    pixels = data[..., :3].astype(np.int32)
    palette = np.array((RGB["forest"], RGB["cream"], RGB["terracotta"], RGB["burnt"]), dtype=np.int32)
    distances = np.sum((pixels[..., None, :] - palette[None, None, :, :]) ** 2, axis=3)
    nearest = np.argmin(distances, axis=2)
    output = np.zeros_like(data)
    if variant == "mono":
        # Treat the light page shapes as paper knockouts so the one-ink master
        # keeps the approved interlaced-page gesture instead of becoming a blob.
        output[..., :3] = RGB["ink"]
        output[..., 3] = np.where(nearest == 1, 0, alpha)
    else:
        replacements = np.array(
            (
                (RGB["cream"], RGB["forest"], RGB["terracotta"], RGB["burnt"])
                if variant == "reversed"
                else ((73, 93, 129), (221, 229, 235), (232, 173, 70), (132, 73, 125))
            ),
            dtype=np.uint8,
        )
        output[..., :3] = replacements[nearest]
        output[..., 3] = alpha
    output[alpha == 0, :3] = 0
    return Image.fromarray(output)


def save_png(image: Image.Image, path: Path) -> None:
    image.convert("RGBA").save(path, format="PNG", optimize=True, compress_level=9)


def write_png_exports() -> dict[str, Image.Image]:
    source = load_source_rgba()
    variants = {
        "color": source,
        "small": source,
        "monochrome": nearest_palette_variant(source, "mono"),
        "reversed": nearest_palette_variant(source, "reversed"),
    }
    for variant, image in variants.items():
        for size in SIZES:
            resized = image.resize((size, size), Image.Resampling.LANCZOS)
            save_png(resized, PNG_DIR / f"wovenleaf-mark-{variant}-{size}px.png")
    save_png(nearest_palette_variant(source, "wrong").resize((256, 256), Image.Resampling.LANCZOS), WORK / "wrong-recolor.png")
    return variants


def prepare_fonts() -> tuple[Path, Path]:
    literata_source, plex_source = font_source_paths()
    literata_out = WORK / "Literata-560.ttf"
    plex_out = WORK / "IBMPlexSans-Regular.ttf"

    literata = FontToolsTTFont(str(literata_source))
    if "fvar" in literata:
        literata = instantiateVariableFont(literata, {"wght": 560}, inplace=False)
    literata.flavor = None
    literata.save(str(literata_out))

    plex = FontToolsTTFont(str(plex_source))
    plex.flavor = None
    plex.save(str(plex_out))
    return literata_out, plex_out


def write_lockup_pngs(variants: dict[str, Image.Image], fonts: tuple[Path, Path]) -> None:
    literata_path, plex_path = fonts
    for width in (512, 1024):
        scale = width / 1024
        for kind in ("horizontal", "tagline", "descriptor"):
            height = round((252 if kind == "horizontal" else 300) * scale)
            image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            mark_side = round(220 * scale)
            mark = variants["color"].resize((mark_side, mark_side), Image.Resampling.LANCZOS)
            image.alpha_composite(mark, (round(12 * scale), round(12 * scale)))
            draw = ImageDraw.Draw(image)
            word_font = ImageFont.truetype(str(literata_path), round(92 * scale))
            support_font = ImageFont.truetype(str(plex_path), round((24 if kind == "tagline" else 19) * scale))
            word_x = round(222 * scale)
            draw.text((word_x, round(58 * scale)), "wovenleaf", font=word_font, fill=COLORS["forest"])
            if kind == "tagline":
                draw.text((word_x, round(175 * scale)), "All your reading. One quiet place.", font=support_font, fill=COLORS["forest"])
            elif kind == "descriptor":
                draw.text((word_x, round(176 * scale)), "P R I V A T E   R E A D I N G   L I B R A R Y", font=support_font, fill=COLORS["forest"])
            save_png(image, PNG_DIR / f"wovenleaf-lockup-{kind}-{width}px.png")


def linear_channel(channel: int) -> float:
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def luminance(color: str) -> float:
    red, green, blue = (linear_channel(value) for value in bytes.fromhex(color.removeprefix("#")))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast(first: str, second: str) -> float:
    light, dark = sorted((luminance(first), luminance(second)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


CVD_MATRICES = {
    "protanopia": np.array(((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998))),
    "deuteranopia": np.array(((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881))),
    "tritanopia": np.array(((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900))),
}


def srgb_to_linear_array(rgb: np.ndarray) -> np.ndarray:
    values = rgb / 255.0
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def linear_to_srgb_array(rgb: np.ndarray) -> np.ndarray:
    clipped = np.clip(rgb, 0, 1)
    values = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1 / 2.4) - 0.055)
    return np.clip(np.round(values * 255), 0, 255).astype(np.uint8)


def simulate_image(image: Image.Image, mode: str) -> Image.Image:
    data = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    linear = srgb_to_linear_array(data[..., :3].astype(np.float64))
    if mode == "grayscale":
        gray = 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]
        transformed = np.repeat(gray[..., None], 3, axis=2)
    else:
        transformed = linear @ CVD_MATRICES[mode].T
    result = np.dstack((linear_to_srgb_array(transformed), data[..., 3]))
    return Image.fromarray(result.astype(np.uint8))


def simulate_rgb(color: str, mode: str) -> np.ndarray:
    rgb = np.array(tuple(bytes.fromhex(color.removeprefix("#"))), dtype=np.float64)
    linear = srgb_to_linear_array(rgb)
    if mode == "grayscale":
        gray = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
        transformed = np.repeat(gray, 3)
    else:
        transformed = CVD_MATRICES[mode] @ linear
    return linear_to_srgb_array(transformed)


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    linear = srgb_to_linear_array(rgb.astype(np.float64))
    xyz = np.array(
        (
            0.4124564 * linear[0] + 0.3575761 * linear[1] + 0.1804375 * linear[2],
            0.2126729 * linear[0] + 0.7151522 * linear[1] + 0.0721750 * linear[2],
            0.0193339 * linear[0] + 0.1191920 * linear[1] + 0.9503041 * linear[2],
        )
    ) / np.array((0.95047, 1.0, 1.08883))
    delta = 6 / 29
    f = np.where(xyz > delta**3, np.cbrt(xyz), xyz / (3 * delta**2) + 4 / 29)
    return np.array((116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])))


def delta_e(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.linalg.norm(rgb_to_lab(first) - rgb_to_lab(second)))


def label_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    paths = (
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Helvetica.ttc"),
    )
    for path in paths:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def centered_label(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, font: ImageFont.ImageFont, color: str) -> None:
    bounds = draw.textbbox((0, 0), text, font=font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text((box[0] + (box[2] - box[0] - width) / 2, box[1] + (box[3] - box[1] - height) / 2 - bounds[1]), text, font=font, fill=color)


def write_background_matrix() -> Path:
    sizes = (16, 24, 32, 64, 1024)
    rows = (("Paper", COLORS["paper"], "color"), ("White", COLORS["white"], "color"), ("Forest", COLORS["forest"], "reversed"), ("System dark", "#161816", "reversed"))
    cell_w, cell_h, label_w, header_h = 180, 170, 150, 72
    image = Image.new("RGB", (label_w + cell_w * len(sizes), header_h + cell_h * len(rows)), COLORS["paper"])
    draw = ImageDraw.Draw(image)
    heading, label = label_font(15, True), label_font(13, True)
    for column, size in enumerate(sizes):
        centered_label(draw, (label_w + column * cell_w, 0, label_w + (column + 1) * cell_w, header_h), f"{size} PX", heading, COLORS["forest"])
    for row_index, (name, background, variant) in enumerate(rows):
        top = header_h + row_index * cell_h
        centered_label(draw, (0, top, label_w, top + cell_h), name.upper(), label, COLORS["forest"])
        for column, size in enumerate(sizes):
            left = label_w + column * cell_w
            draw.rectangle((left, top, left + cell_w, top + cell_h), fill=background)
            source_variant = "small" if size < 32 and variant == "color" else variant
            path = PNG_DIR / f"wovenleaf-mark-{source_variant}-{size}px.png"
            with Image.open(path) as source:
                mark = source.convert("RGBA")
            display = max(1, round(min(120, size * (5 if size <= 24 else 1.6))))
            mark = mark.resize((display, display), Image.Resampling.NEAREST if size <= 24 else Image.Resampling.LANCZOS)
            image.paste(mark, (left + (cell_w - display) // 2, top + (cell_h - display) // 2), mark)
    path = QA_DIR / "size-background-matrix.png"
    image.save(path, optimize=True, compress_level=9)
    return path


def write_simulation_matrix() -> Path:
    modes = ("original", "grayscale", "protanopia", "deuteranopia", "tritanopia")
    cell_w, cell_h = 228, 244
    image = Image.new("RGB", (cell_w * len(modes), cell_h), COLORS["paper"])
    draw = ImageDraw.Draw(image)
    font = label_font(13, True)
    with Image.open(PNG_DIR / "wovenleaf-mark-color-256px.png") as source:
        mark = source.convert("RGBA").resize((168, 168), Image.Resampling.LANCZOS)
    for index, mode in enumerate(modes):
        left = index * cell_w
        shown = mark if mode == "original" else simulate_image(mark, mode)
        image.paste(shown, (left + 30, 48), shown)
        centered_label(draw, (left, 8, left + cell_w, 38), mode.upper(), font, COLORS["forest"])
    path = QA_DIR / "color-vision-simulation-matrix.png"
    image.save(path, optimize=True, compress_level=9)
    return path


def write_silhouette_matrix() -> Path:
    sizes = (16, 24, 32, 64, 1024)
    cell_w, cell_h, label_w, header_h = 180, 170, 150, 72
    image = Image.new("RGB", (label_w + cell_w * len(sizes), header_h + cell_h), COLORS["paper"])
    draw = ImageDraw.Draw(image)
    heading, label = label_font(15, True), label_font(13, True)
    centered_label(draw, (0, header_h, label_w, header_h + cell_h), "SILHOUETTE", label, COLORS["forest"])
    for column, size in enumerate(sizes):
        left = label_w + column * cell_w
        centered_label(draw, (left, 0, left + cell_w, header_h), f"{size} PX", heading, COLORS["forest"])
        path = PNG_DIR / f"wovenleaf-mark-{'small' if size < 32 else 'color'}-{size}px.png"
        with Image.open(path) as source:
            alpha = source.convert("RGBA").getchannel("A")
        solid = Image.new("RGBA", alpha.size, (*RGB["ink"], 0))
        solid.putalpha(alpha)
        display = max(1, round(min(120, size * (5 if size <= 24 else 1.6))))
        solid = solid.resize((display, display), Image.Resampling.NEAREST if size <= 24 else Image.Resampling.LANCZOS)
        image.paste(solid, (left + (cell_w - display) // 2, header_h + (cell_h - display) // 2), solid)
    path = QA_DIR / "silhouette-matrix.png"
    image.save(path, optimize=True, compress_level=9)
    return path


def silhouette_metrics(path: Path) -> dict[str, float | bool]:
    with Image.open(path) as source:
        alpha = source.convert("RGBA").getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return {"bbox_x": 0.0, "bbox_y": 0.0, "occupancy": 0.0, "pass": False}
    width, height = alpha.size
    values = np.asarray(alpha)
    result = {
        "bbox_x": round((bbox[2] - bbox[0]) / width, 4),
        "bbox_y": round((bbox[3] - bbox[1]) / height, 4),
        "occupancy": round(float(np.mean(values >= 128)), 4),
    }
    result["pass"] = result["bbox_x"] >= 0.48 and result["bbox_y"] >= 0.80 and result["occupancy"] >= 0.22
    return result


def pdf_contains_images(reader: PdfReader) -> bool:
    visited: set[tuple[int, int]] = set()

    def inspect(resources: object) -> bool:
        if not resources:
            return False
        resource = resources.get_object() if hasattr(resources, "get_object") else resources
        xobjects = resource.get("/XObject") if hasattr(resource, "get") else None
        if not xobjects:
            return False
        xobjects = xobjects.get_object()
        for value in xobjects.values():
            obj = value.get_object()
            reference = (getattr(value, "idnum", id(obj)), getattr(value, "generation", 0))
            if reference in visited:
                continue
            visited.add(reference)
            subtype = obj.get("/Subtype")
            if subtype == "/Image":
                return True
            if subtype == "/Form" and inspect(obj.get("/Resources")):
                return True
        return False

    return any(inspect(page.get("/Resources")) for page in reader.pages)


def build_qa_report() -> dict[str, object]:
    sizes = (16, 24, 32, 64, 1024)
    silhouettes = {
        str(size): silhouette_metrics(PNG_DIR / f"wovenleaf-mark-{'small' if size < 32 else 'color'}-{size}px.png")
        for size in sizes
    }
    source_root = ET.parse(SOURCE_SVG).getroot()
    source_tags = {node.tag.rsplit("}", 1)[-1] for node in source_root.iter()}
    source_integrity = {path.name: sha256(path) == expected for path, expected in ((path, SOURCE_HASHES[path.name]) for path in (SOURCE_SVG, SOURCE_PDF, SOURCE_PNG))}
    vector_pdf = PdfReader(str(SOURCE_PDF))
    color_pairs = (("forest", "cream"), ("forest", "terracotta"), ("terracotta", "cream"))
    color_vision_results: dict[str, dict[str, float]] = {}
    for mode in ("grayscale", "protanopia", "deuteranopia", "tritanopia"):
        color_vision_results[mode] = {
            f"{first}_{second}": round(delta_e(simulate_rgb(COLORS[first], mode), simulate_rgb(COLORS[second], mode)), 2)
            for first, second in color_pairs
        }
    color_vision_thresholds = {"grayscale": 18.0, "protanopia": 22.0, "deuteranopia": 22.0, "tritanopia": 22.0}
    tests = {
        "canonical_source_integrity": {"results": source_integrity, "pass": all(source_integrity.values())},
        "svg_is_vector_and_text_free": {"images": "image" in source_tags, "text": "text" in source_tags, "pass": "image" not in source_tags and "text" not in source_tags},
        "pdf_is_vector": {"pages": len(vector_pdf.pages), "contains_images": pdf_contains_images(vector_pdf), "pass": len(vector_pdf.pages) == 1 and not pdf_contains_images(vector_pdf)},
        "text_contrast": {
            "threshold": 4.5,
            "results": {"forest_cream": round(contrast(COLORS["forest"], COLORS["cream"]), 3), "ink_paper": round(contrast(COLORS["ink"], COLORS["paper"]), 3)},
        },
        "graphic_contrast": {
            "threshold": 3.0,
            "results": {"forest_terracotta": round(contrast(COLORS["forest"], COLORS["terracotta"]), 3), "terracotta_cream": round(contrast(COLORS["terracotta"], COLORS["cream"]), 3)},
        },
        "color_vision_separation": {
            "metric": "CIE76 delta E",
            "thresholds": color_vision_thresholds,
            "results": color_vision_results,
            "pass": all(min(values.values()) >= color_vision_thresholds[mode] for mode, values in color_vision_results.items()),
        },
        "silhouette": {"results": silhouettes, "pass": all(bool(item["pass"]) for item in silhouettes.values())},
        "required_sizes": {"sizes": list(sizes), "pass": all((PNG_DIR / f"wovenleaf-mark-{'small' if size < 32 else 'color'}-{size}px.png").exists() for size in sizes)},
    }
    tests["text_contrast"]["pass"] = min(tests["text_contrast"]["results"].values()) >= 4.5  # type: ignore[index,union-attr]
    tests["graphic_contrast"]["pass"] = min(tests["graphic_contrast"]["results"].values()) >= 3.0  # type: ignore[index,union-attr]
    overall = all(bool(test.get("pass")) for test in tests.values())
    return {"identity": "Wovenleaf", "version": "1.0", "generated": "2026-08-25", "tests": tests, "overall_pass": overall}


def write_qa_report(report: dict[str, object]) -> None:
    (QA_DIR / "qa-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    tests = report["tests"]
    rows = (
        ("Canonical files match approved inputs", "SHA-256 exact", tests["canonical_source_integrity"]["pass"]),
        ("SVG contains paths only", "0 images / 0 text", tests["svg_is_vector_and_text_free"]["pass"]),
        ("PDF vector master", "1 page / 0 raster images", tests["pdf_is_vector"]["pass"]),
        ("Text contrast", ">= 4.5:1", tests["text_contrast"]["pass"]),
        ("Large-graphic contrast", ">= 3.0:1", tests["graphic_contrast"]["pass"]),
        ("Color-vision separation", "Grayscale + three CVD simulations", tests["color_vision_separation"]["pass"]),
        ("Silhouette at required sizes", "16 / 24 / 32 / 64 / 1024 px", tests["silhouette"]["pass"]),
    )
    lines = ["# Wovenleaf identity QA", "", f"Overall: **{'PASS' if report['overall_pass'] else 'FAIL'}**", "", "| Check | Evidence | Result |", "| --- | --- | --- |"]
    lines.extend(f"| {name} | {evidence} | {'PASS' if passed else 'FAIL'} |" for name, evidence, passed in rows)
    lines.extend(("", "Visual evidence:", "", "- `size-background-matrix.png`", "- `color-vision-simulation-matrix.png`", "- `silhouette-matrix.png`", "", "Exact measurements and hashes are recorded in `qa-report.json`."))
    (QA_DIR / "qa-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def register_pdf_fonts(fonts: tuple[Path, Path]) -> None:
    pdfmetrics.registerFont(ReportLabTTFont("WovenleafLiterata", str(fonts[0])))
    pdfmetrics.registerFont(ReportLabTTFont("WovenleafPlex", str(fonts[1])))


def pdf_paragraph(c: canvas.Canvas, text: str, x: float, y: float, width: float, *, size: float = 9, leading: float = 13, color: str = COLORS["ink"], font: str = "WovenleafPlex") -> float:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    c.setFillColor(HexColor(color))
    text_object = c.beginText(x, y)
    text_object.setFont(font, size)
    text_object.setLeading(leading)
    text_object.setCharSpace(0)
    for line in lines:
        text_object.textLine(line)
    c.drawText(text_object)
    return y - leading * len(lines)


def pdf_label(c: canvas.Canvas, text: str, x: float, y: float, color: str = COLORS["terracotta"]) -> None:
    c.setFillColor(HexColor(color))
    obj = c.beginText(x, y)
    obj.setFont("WovenleafPlex", 7.2)
    obj.setCharSpace(1.35)
    obj.textLine(text.upper())
    c.drawText(obj)


def pdf_page(c: canvas.Canvas, width: float, height: float, page: int, title: str, *, dark: bool = False) -> None:
    background = COLORS["forest"] if dark else COLORS["paper"]
    foreground = COLORS["cream"] if dark else COLORS["forest"]
    c.setFillColor(HexColor(background))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(HexColor(foreground))
    c.setFont("WovenleafPlex", 7.5)
    c.drawString(36, height - 35, "WOVENLEAF / IDENTITY 1.0")
    c.drawRightString(width - 36, height - 35, f"{page:02d} / {title.upper()}")
    c.setStrokeColor(HexColor(foreground))
    c.setLineWidth(0.45)
    c.line(36, height - 44, width - 36, height - 44)


def pdf_heading(c: canvas.Canvas, text: str, x: float, y: float, *, dark: bool = False, size: float = 31) -> None:
    c.setFillColor(HexColor(COLORS["cream"] if dark else COLORS["forest"]))
    c.setFont("WovenleafLiterata", size)
    c.drawString(x, y, text)


def pdf_mark(c: canvas.Canvas, image_path: Path, x: float, y: float, size: float) -> None:
    c.drawImage(ImageReader(str(image_path)), x, y, width=size, height=size, preserveAspectRatio=True, mask="auto")


def build_guide_pdf(report: dict[str, object]) -> Path:
    path = FINAL / "wovenleaf-brand-mini-guide.pdf"
    width, height = A4
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1, pageCompression=1)
    c.setTitle("Wovenleaf Brand Mini-Guide")
    c.setAuthor("Wovenleaf")

    # 1 - Cover
    c.setFillColor(HexColor(COLORS["forest"]))
    c.rect(0, 0, width, height, fill=1, stroke=0)
    pdf_mark(c, PNG_DIR / "wovenleaf-mark-reversed-1024px.png", 46, height - 310, 235)
    c.setFillColor(HexColor(COLORS["cream"]))
    c.setFont("WovenleafLiterata", 56)
    c.drawString(56, height - 380, "wovenleaf")
    c.setFillColor(HexColor(COLORS["terracotta"]))
    c.setFont("WovenleafPlex", 12.5)
    c.drawString(58, height - 416, "All your reading. One quiet place.")
    c.setFillColor(HexColor(COLORS["cream"]))
    c.setFont("WovenleafPlex", 8)
    c.drawString(58, 58, "PRODUCTION IDENTITY / VERSION 1.0")
    c.drawRightString(width - 58, 58, "25 AUGUST 2026")

    # 2 - Story
    c.showPage(); pdf_page(c, width, height, 2, "Story and tone")
    pdf_heading(c, "A leaf made from pages.", 42, height - 102)
    pdf_paragraph(c, "Wovenleaf is a private reading library: a calm home for books gathered, chosen, read, and remembered without performance or noise. The vector mark preserves the original concept's tall folded page, offset leaf point, and long stem.", 44, height - 145, 282, size=10, leading=15)
    pdf_mark(c, PNG_DIR / "wovenleaf-mark-color-1024px.png", width - 265, height - 370, 225)
    pdf_label(c, "Brand story", 44, height - 304)
    pdf_paragraph(c, "Books move through a life in small, private ways: a title saved for later, a book kept close for a week, a sentence remembered years afterward. Wovenleaf gives those moments one quiet place.", 44, height - 331, 270, size=8.8, leading=13)
    pdf_label(c, "Tone", 44, height - 455)
    tone = (("PERSONAL", "Concrete reading moments."), ("CALM", "Plain verbs; no urgency theater."), ("KNOWING", "Respect readers without performing taste."), ("TACTILE", "Page, margin, shelf, paper - sparingly."))
    for index, (name, copy) in enumerate(tone):
        x = 44 + (index % 2) * 260; y = height - 493 - (index // 2) * 82
        c.setFillColor(HexColor(COLORS["forest"])); c.setFont("WovenleafPlex", 8); c.drawString(x, y, name)
        pdf_paragraph(c, copy, x, y - 20, 220, size=8.2, leading=11.5)
    c.setFillColor(HexColor(COLORS["forest"])); c.roundRect(44, 72, width - 88, 118, 8, fill=1, stroke=0)
    c.setFillColor(HexColor(COLORS["cream"])); c.setFont("WovenleafLiterata", 14)
    for i, sample in enumerate(("Pick up where you left off.", "A quiet shelf for every maybe.", "Finished. Kept. Remembered.")):
        c.drawString(62, 151 - i * 27, sample)

    # 3 - Variants
    c.showPage(); pdf_page(c, width, height, 3, "Identity system")
    pdf_heading(c, "One mark, seven practical forms.", 42, height - 102)
    variants = (("COLOR", "color", "Default on light fields"), ("SMALL", "small", "16-31 px"), ("MONO", "monochrome", "Single-ink reproduction"), ("REVERSED", "reversed", "Dark fields"))
    card_w, card_h = 244, 190
    for index, (name, variant, copy) in enumerate(variants):
        x = 42 + (index % 2) * 268; y = height - 335 - (index // 2) * 214
        dark = variant == "reversed"
        c.setFillColor(HexColor(COLORS["forest"] if dark else COLORS["white"])); c.roundRect(x, y, card_w, card_h, 8, fill=1, stroke=0)
        pdf_mark(c, PNG_DIR / f"wovenleaf-mark-{variant}-256px.png", x + 14, y + 30, 125)
        c.setFillColor(HexColor(COLORS["cream"] if dark else COLORS["forest"])); c.setFont("WovenleafPlex", 8); c.drawString(x + 146, y + 112, name)
        pdf_paragraph(c, copy, x + 146, y + 88, 82, size=7.4, leading=10, color=COLORS["cream"] if dark else COLORS["ink"])
    pdf_label(c, "Lockups", 42, 118)
    pdf_paragraph(c, "Horizontal, tagline, and descriptor masters are supplied as standalone, self-contained SVG files with embedded fonts.", 42, 94, width - 84, size=8.4, leading=12)

    # 4 - Space and scale
    c.showPage(); pdf_page(c, width, height, 4, "Space and scale")
    pdf_heading(c, "Let the mark breathe.", 42, height - 102)
    mark_size, x, y = 230, 74, height - 414
    clear = mark_size * 0.25
    c.setStrokeColor(HexColor(COLORS["terracotta"])); c.setDash(3, 3); c.rect(x - clear, y - clear, mark_size + 2 * clear, mark_size + 2 * clear, fill=0, stroke=1); c.setDash()
    pdf_mark(c, PNG_DIR / "wovenleaf-mark-color-1024px.png", x, y, mark_size)
    c.setFillColor(HexColor(COLORS["terracotta"])); c.setFont("WovenleafPlex", 7.5); c.drawString(x - clear, y - clear - 18, "CLEAR SPACE = 1/4 VISIBLE MARK WIDTH")
    pdf_label(c, "Minimum sizes", 377, height - 156)
    rows = (("Small mark", "16 px", "5 mm"), ("Color mark", "32 px", "8 mm"), ("Horizontal", "112 px", "30 mm"), ("Descriptor", "160 px", "42 mm"), ("Tagline", "220 px", "58 mm"))
    yy = height - 193
    for name, digital, printed in rows:
        c.setStrokeColor(HexColor(COLORS["mist"])); c.line(377, yy + 15, width - 42, yy + 15)
        c.setFillColor(HexColor(COLORS["ink"])); c.setFont("WovenleafPlex", 7.8); c.drawString(377, yy, name); c.drawString(469, yy, digital); c.drawRightString(width - 42, yy, printed); yy -= 34
    pdf_label(c, "Rule", 377, height - 400)
    pdf_paragraph(c, "Use the small-size master from 16 through 31 px. When a lockup becomes too small, remove the supporting line instead of shrinking it into noise.", 377, height - 426, width - 419, size=8.2, leading=12)

    # 5 - Color
    c.showPage(); pdf_page(c, width, height, 5, "Color")
    pdf_heading(c, "Forest, paper, earth.", 42, height - 102)
    swatches = (("FOREST", "forest"), ("CREAM", "cream"), ("TERRACOTTA", "terracotta"), ("BURNT", "burnt"), ("INK", "ink"), ("PAPER", "paper"))
    yy = height - 165
    for index, (name, key) in enumerate(swatches):
        x = 42 + (index % 2) * 260; y = yy - (index // 2) * 105
        c.setFillColor(HexColor(COLORS[key])); c.roundRect(x, y - 65, 112, 70, 6, fill=1, stroke=0)
        text_color = COLORS["cream"] if key in {"forest", "ink", "burnt"} else COLORS["forest"]
        c.setFillColor(HexColor(text_color)); c.setFont("WovenleafPlex", 7.5); c.drawString(x + 12, y - 22, name); c.drawString(x + 12, y - 42, COLORS[key])
    pdf_label(c, "Approved contrast", 42, height - 520)
    pairs = (("Forest / cream", contrast(COLORS["forest"], COLORS["cream"])), ("Ink / paper", contrast(COLORS["ink"], COLORS["paper"])), ("Forest / terracotta", contrast(COLORS["forest"], COLORS["terracotta"])), ("Terracotta / cream", contrast(COLORS["terracotta"], COLORS["cream"])))
    yy = height - 555
    for label, ratio in pairs:
        c.setFillColor(HexColor(COLORS["ink"])); c.setFont("WovenleafPlex", 8.5); c.drawString(42, yy, label); c.drawRightString(255, yy, f"{ratio:.2f}:1"); yy -= 27
    c.setFillColor(HexColor(COLORS["forest"])); c.roundRect(320, 92, 233, 229, 8, fill=1, stroke=0)
    pdf_mark(c, PNG_DIR / "wovenleaf-mark-reversed-256px.png", 365, 150, 150)
    pdf_paragraph(c, "Terracotta is for large graphics and accents, never small body copy on Cream.", 340, 130, 180, size=7.7, leading=10.5, color=COLORS["cream"])

    # 6 - Lockups and voice
    c.showPage(); pdf_page(c, width, height, 6, "Lockups and voice")
    pdf_heading(c, "Literary, never precious.", 42, height - 102)
    c.setFillColor(HexColor(COLORS["forest"])); c.setFont("WovenleafLiterata", 48); c.drawString(42, height - 190, "wovenleaf")
    pdf_label(c, "Tagline", 44, height - 246)
    c.setFillColor(HexColor(COLORS["forest"])); c.setFont("WovenleafPlex", 13); c.drawString(44, height - 276, "All your reading. One quiet place.")
    pdf_paragraph(c, "Use on first-contact surfaces: launch pages, store artwork, press materials, and presentation covers. Preserve the exact sentence case and punctuation.", 44, height - 308, 238, size=8.4, leading=12)
    pdf_label(c, "Descriptor", 44, height - 420)
    c.setFillColor(HexColor(COLORS["forest"])); c.setFont("WovenleafPlex", 10); c.drawString(44, height - 450, "P R I V A T E   R E A D I N G   L I B R A R Y")
    pdf_paragraph(c, "Use where the category is not obvious. Never show descriptor and tagline together.", 44, height - 482, 238, size=8.4, leading=12)
    c.setFillColor(HexColor(COLORS["forest"])); c.roundRect(322, 110, 231, 535, 8, fill=1, stroke=0)
    pdf_mark(c, PNG_DIR / "wovenleaf-mark-reversed-256px.png", 352, 444, 170)
    pdf_label(c, "When to stand alone", 342, 410, COLORS["terracotta"])
    rules = ("Mark: app icon, avatar, favicon, repeated UI.", "Wordmark: navigation and product chrome.", "Tagline: introduction and campaign context.", "Descriptor: category clarity and formal context.")
    yy = 376
    for rule in rules:
        yy = pdf_paragraph(c, rule, 342, yy, 190, size=8.2, leading=11.5, color=COLORS["cream"]) - 22
    pdf_label(c, "Feels like Wovenleaf", 342, 187, COLORS["terracotta"])
    pdf_paragraph(c, "Warm and lived-in means quiet paper color and direct copy - not sepia filters, distressed type, faux-vintage language, or nostalgic clutter.", 342, 160, 190, size=8.2, leading=11.5, color=COLORS["cream"])

    # 7 - Misuse
    c.showPage(); pdf_page(c, width, height, 7, "Misuse")
    pdf_heading(c, "Keep the gesture intact.", 42, height - 102)
    cards = (("DO NOT STRETCH", "stretch"), ("DO NOT ROTATE", "rotate"), ("DO NOT RECOLOR", "mono"), ("DO NOT ADD EFFECTS", "shadow"), ("DO NOT CROP", "crop"), ("DO NOT ADD DETAIL", "detail"))
    card_w, card_h = 158, 230
    source = ImageReader(str(PNG_DIR / "wovenleaf-mark-color-256px.png"))
    for index, (label, mode) in enumerate(cards):
        x = 42 + (index % 3) * 171; y = height - 370 - (index // 3) * 248
        c.setFillColor(HexColor(COLORS["white"])); c.roundRect(x, y, card_w, card_h, 7, fill=1, stroke=0)
        c.saveState()
        if mode == "rotate":
            c.translate(x + card_w / 2, y + 137); c.rotate(18); c.drawImage(source, -62, -62, 124, 124, mask="auto")
        elif mode == "stretch":
            c.drawImage(source, x + 12, y + 76, card_w - 24, 90, mask="auto")
        elif mode == "mono":
            c.drawImage(ImageReader(str(WORK / "wrong-recolor.png")), x + 20, y + 68, 118, 118, mask="auto")
        else:
            c.drawImage(source, x + 20, y + 68, 118, 118, mask="auto")
            if mode == "shadow":
                c.setStrokeColor(HexColor(COLORS["ink"])); c.setLineWidth(5); c.circle(x + 79, y + 127, 58, fill=0, stroke=1)
            elif mode == "crop":
                c.setFillColor(HexColor(COLORS["white"])); c.rect(x, y + 68, 43, 118, fill=1, stroke=0); c.rect(x + card_w - 43, y + 68, 43, 118, fill=1, stroke=0)
            elif mode == "detail":
                c.setStrokeColor(HexColor(COLORS["terracotta"])); c.setLineWidth(1)
                for offset in range(5): c.line(x + 34, y + 92 + offset * 15, x + 124, y + 105 + offset * 15)
        c.restoreState()
        c.setFillColor(HexColor(COLORS["terracotta"])); c.setFont("WovenleafPlex", 6.8); c.drawCentredString(x + card_w / 2, y + 28, label)
    pdf_paragraph(c, "Also avoid outlines, gradients, busy photography, hand-built simplifications, and any text inside a mark-only app icon.", 42, 58, width - 84, size=7.8, leading=11)

    # 8 - Delivery
    c.showPage(); pdf_page(c, width, height, 8, "Delivery", dark=True)
    pdf_heading(c, "Named to be found again.", 42, height - 102, dark=True)
    pdf_label(c, "Export convention", 44, height - 158)
    c.setFillColor(HexColor(COLORS["cream"])); c.setFont("WovenleafPlex", 10); c.drawString(44, height - 187, "wovenleaf-{asset}-{variant}-{size}.{ext}")
    sections = (("CANONICAL", "Approved SVG, vector PDF, and 2048 px PNG"), ("VARIANTS", "Small, monochrome, reversed, horizontal, tagline, descriptor"), ("PNG", "16, 24, 32, 64, 256, and 1024 px exports"), ("QA", "Background, color-vision, and silhouette matrices plus measured evidence"))
    yy = height - 245
    for name, copy in sections:
        pdf_label(c, name, 44, yy); pdf_paragraph(c, copy, 180, yy, 330, size=8.4, leading=12, color=COLORS["cream"]); yy -= 68
    pdf_label(c, "Automated result", 44, height - 545)
    c.setFillColor(HexColor(COLORS["cream"])); c.setFont("WovenleafLiterata", 27); c.drawString(44, height - 585, "PASS" if report["overall_pass"] else "FAIL")
    pdf_paragraph(c, "Canonical hashes, vector integrity, contrast, silhouette, and all required sizes are recorded in final/qa/qa-report.json.", 140, height - 566, 370, size=8.4, leading=12, color=COLORS["cream"])
    c.setFillColor(HexColor(COLORS["cream"])); c.roundRect(44, 92, width - 88, 116, 8, fill=1, stroke=0)
    pdf_label(c, "Working-name dependency", 62, 174, COLORS["terracotta"])
    pdf_paragraph(c, "QUI-6 uses Wovenleaf as the working production name while QUI-7 completes name validation. A name change only requires rebuilding the three text lockups; the approved mark remains intact.", 62, 148, width - 124, size=8.5, leading=12, color=COLORS["forest"])

    c.save()
    return path


def render_pdf_preview(pdf: Path) -> None:
    executable = shutil.which("pdftoppm")
    if not executable:
        raise RuntimeError("pdftoppm is required for PDF verification")
    preview = WORK / "pdf-preview"
    if preview.exists():
        shutil.rmtree(preview)
    preview.mkdir(parents=True)
    subprocess.run((executable, "-png", "-r", "110", str(pdf), str(preview / pdf.stem)), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def validate_outputs(guide: Path) -> None:
    if len(PdfReader(str(guide)).pages) != 8:
        raise AssertionError("Brand guide must contain 8 pages")
    required = (FINAL / "wovenleaf-mark-small.svg", FINAL / "wovenleaf-mark-monochrome.svg", FINAL / "wovenleaf-mark-reversed.svg", FINAL / "wovenleaf-lockup-horizontal.svg", FINAL / "wovenleaf-lockup-tagline.svg", FINAL / "wovenleaf-lockup-descriptor.svg", QA_DIR / "qa-report.json")
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise AssertionError(f"Missing outputs: {missing}")


def write_manifest() -> None:
    assets = sorted((path for path in FINAL.rglob("*") if path.is_file() and path.name != "manifest.json"), key=lambda path: str(path.relative_to(FINAL)))
    manifest = {"identity": "Wovenleaf", "version": "1.0", "files": [{"path": str(path.relative_to(FINAL)), "sha256": sha256(path), "bytes": path.stat().st_size} for path in assets]}
    (FINAL / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    ensure_directories()
    assert_canonical_sources()
    write_mark_variants()
    write_lockups()
    variants = write_png_exports()
    fonts = prepare_fonts()
    write_lockup_pngs(variants, fonts)
    write_background_matrix()
    write_simulation_matrix()
    write_silhouette_matrix()
    report = build_qa_report()
    write_qa_report(report)
    register_pdf_fonts(fonts)
    guide = build_guide_pdf(report)
    validate_outputs(guide)
    render_pdf_preview(guide)
    write_manifest()
    if not report["overall_pass"]:
        raise SystemExit("Wovenleaf QA failed; inspect branding/final/qa/qa-report.json")
    print("Built Wovenleaf identity from approved vectorized sources; QA PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
