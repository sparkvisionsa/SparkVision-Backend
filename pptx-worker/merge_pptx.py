#!/usr/bin/env python3
"""Merge the machine-valuation PowerPoint template on the server.

The worker intentionally uses only the Python standard library.  This keeps the
generated package close to the original PPTX: existing XML parts are copied as
bytes and only the slide, relationship, media and content-type parts that need
to change are rewritten.
"""

from __future__ import annotations

import html
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any


TEXT_NODE_RE = re.compile(r"<a:t(?P<attrs>\s[^>]*)?>(?P<text>.*?)</a:t>", re.DOTALL)
PARAGRAPH_RE = re.compile(r"<a:p(?:\s[^>]*)?>.*?</a:p>", re.DOTALL)
SHAPE_RE = re.compile(r"<p:sp\b[^>]*>.*?</p:sp>", re.DOTALL)
SLIDE_PATH_RE = re.compile(r"^ppt/slides/slide(\d+)\.xml$", re.IGNORECASE)
TEMPLATE_VARIABLE_RE = re.compile(
    r"(?:<<\s*([^<>\r\n]{1,160}?)\s*>>|>>\s*([^<>\r\n]{1,160}?)\s*<<|"
    r"\u00ab\s*([^\u00ab\u00bb\r\n]{1,160}?)\s*\u00bb|\u00bb\s*([^\u00ab\u00bb\r\n]{1,160}?)\s*\u00ab)",
    re.DOTALL,
)

IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
ASSET_IMAGES_KEY = "assetimages"
DEFAULT_ASSET_IMAGE_MARKERS = (
    "صور_الاصول",
    "صور_الأصول",
    "مرفق الصور1",
    "مرفق_الصور1",
    "assetImages",
    "assetImage",
)
DEFAULT_VALUATION_IMAGE_MARKERS = (
    "صور_حسابات_القيمة",
    "صورحساباتالقيمة",
    "valuationImages",
)
DEFAULT_CLIENT_IMAGE_MARKERS = (
    "صور_ملفات_العميل",
    "صورملفاتالعميل",
    "clientImages",
)
DEFAULT_CERTIFICATE_IMAGE_MARKERS = (
    "صور_شهادة_قيمة",
    "صور_شهادة_النظام",
    "sceCertificateImages",
    "certificateImages",
)
ASSET_HEADING_HINTS = (
    "الصورالفوتوغرافية",
    "صورالأصول",
    "صورالاصول",
    "مرفقالصور",
    ASSET_IMAGES_KEY,
)
VALUATION_HEADING_HINTS = (
    "صورحساباتالقيمة",
    "الوصفالجزئيوحساباتالقيمة",
)
CLIENT_HEADING_HINTS = (
    "صورملفاتالعميل",
    "ملفاتالعميل",
    "المستنداتالمستلمةمنالعميل",
)
CERTIFICATE_HEADING_HINTS = (
    "شهادةالتسجيلفيبوابةتقييم",
    "شهادةنظامالهيئة",
    "شهادةقيمة",
)


def xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\u200e\u200f\u202a-\u202e]", "", value)).strip()


def normalized_name_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {
        normalize_name(str(item)).casefold()
        for item in value
        if isinstance(item, str) and normalize_name(item)
    }


def find_value_key(variable_name: str, values: dict[str, str]) -> str | None:
    if variable_name in values:
        return variable_name
    normalized = normalize_name(variable_name).casefold()
    for key in values:
        if normalize_name(key).casefold() == normalized:
            return key
    return None


def rewrite_paragraph_variables(
    paragraph_xml: str,
    values: dict[str, str],
    stats: dict[str, Any],
    excluded_variable_names: set[str],
) -> str:
    nodes: list[dict[str, Any]] = []
    offset = 0
    for match in TEXT_NODE_RE.finditer(paragraph_xml):
        text = html.unescape(match.group("text") or "")
        nodes.append(
            {
                "start": offset,
                "end": offset + len(text),
                "text": text,
            }
        )
        offset += len(text)

    if not nodes:
        return paragraph_xml

    full_text = "".join(node["text"] for node in nodes)
    replacements: list[dict[str, Any]] = []
    for match in TEMPLATE_VARIABLE_RE.finditer(full_text):
        raw = match.group(0) or ""
        raw_variable = next((group for group in match.groups() if group is not None), "")
        variable_name = normalize_name(raw_variable)
        if not variable_name:
            continue
        stats["variablesFound"].add(variable_name)
        if variable_name.casefold() in excluded_variable_names:
            continue
        key = find_value_key(variable_name, values)
        if key is None:
            continue
        start, end = match.span()
        variable_start = start + max(0, raw.find(raw_variable))
        target_node = next(
            (
                index
                for index, node in enumerate(nodes)
                if node["start"] <= variable_start < node["end"]
            ),
            None,
        )
        if target_node is None:
            target_node = next(
                (
                    index
                    for index, node in enumerate(nodes)
                    if node["start"] < end and node["end"] > start
                ),
                None,
            )
        if target_node is None:
            continue
        replacements.append(
            {
                "start": start,
                "end": end,
                "target": target_node,
                "value": values.get(key, ""),
            }
        )
        stats["variablesFilled"] += 1

    if not replacements:
        return paragraph_xml

    rewritten: list[str] = []
    for node_index, node in enumerate(nodes):
        cursor = node["start"]
        output = ""
        for replacement in replacements:
            overlap_start = max(node["start"], replacement["start"])
            overlap_end = min(node["end"], replacement["end"])
            if overlap_start >= overlap_end:
                continue
            output += node["text"][cursor - node["start"] : overlap_start - node["start"]]
            if replacement["target"] == node_index:
                output += replacement["value"]
            cursor = overlap_end
        output += node["text"][cursor - node["start"] :]
        rewritten.append(output)

    text_node_index = 0

    def replace_text_node(match: re.Match[str]) -> str:
        nonlocal text_node_index
        attrs = match.group("attrs") or ""
        text = rewritten[text_node_index] if text_node_index < len(rewritten) else ""
        text_node_index += 1
        return f"<a:t{attrs}>{xml_escape(text)}</a:t>"

    return TEXT_NODE_RE.sub(replace_text_node, paragraph_xml)


def replace_variables_in_slide(
    slide_xml: str,
    values: dict[str, str],
    stats: dict[str, Any],
    excluded_variable_names: set[str],
) -> str:
    return PARAGRAPH_RE.sub(
        lambda match: rewrite_paragraph_variables(
            match.group(0), values, stats, excluded_variable_names
        ),
        slide_xml,
    )


def clear_marker_variables_in_paragraph(
    paragraph_xml: str,
    marker_variables: set[str],
) -> str:
    """Remove a configured image-token without disturbing split text runs."""
    nodes: list[dict[str, Any]] = []
    offset = 0
    for match in TEXT_NODE_RE.finditer(paragraph_xml):
        text = html.unescape(match.group("text") or "")
        nodes.append(
            {"start": offset, "end": offset + len(text), "text": text}
        )
        offset += len(text)
    if not nodes:
        return paragraph_xml
    full_text = "".join(node["text"] for node in nodes)
    replacements: list[dict[str, Any]] = []
    for match in TEMPLATE_VARIABLE_RE.finditer(full_text):
        raw_variable = next((group for group in match.groups() if group is not None), "")
        if not variable_matches_markers(raw_variable, marker_variables):
            continue
        start, end = match.span()
        variable_start = start + max(0, (match.group(0) or "").find(raw_variable))
        target_node = next(
            (
                index
                for index, node in enumerate(nodes)
                if node["start"] <= variable_start < node["end"]
            ),
            None,
        )
        if target_node is None:
            target_node = next(
                (
                    index
                    for index, node in enumerate(nodes)
                    if node["start"] < end and node["end"] > start
                ),
                None,
            )
        if target_node is not None:
            replacements.append({"start": start, "end": end, "target": target_node})
    if not replacements:
        return paragraph_xml

    rewritten: list[str] = []
    for node_index, node in enumerate(nodes):
        cursor = node["start"]
        output = ""
        for replacement in replacements:
            overlap_start = max(node["start"], replacement["start"])
            overlap_end = min(node["end"], replacement["end"])
            if overlap_start >= overlap_end:
                continue
            output += node["text"][cursor - node["start"] : overlap_start - node["start"]]
            # The token disappears entirely; any surrounding text survives.
            cursor = overlap_end
        output += node["text"][cursor - node["start"] :]
        rewritten.append(output)

    text_node_index = 0

    def replace_text_node(match: re.Match[str]) -> str:
        nonlocal text_node_index
        attrs = match.group("attrs") or ""
        text = rewritten[text_node_index] if text_node_index < len(rewritten) else ""
        text_node_index += 1
        return f"<a:t{attrs}>{xml_escape(text)}</a:t>"

    return TEXT_NODE_RE.sub(replace_text_node, paragraph_xml)


def clear_marker_variables_in_slide(slide_xml: str, marker_variables: set[str]) -> str:
    if not marker_variables:
        return slide_xml
    return PARAGRAPH_RE.sub(
        lambda match: clear_marker_variables_in_paragraph(
            match.group(0), marker_variables
        ),
        slide_xml,
    )


def text_in_shape(shape_xml: str) -> str:
    return "".join(
        html.unescape(match.group("text") or "") for match in TEXT_NODE_RE.finditer(shape_xml)
    )


def compact_marker(value: str) -> str:
    return re.sub(r"[\s_:\-./0-9]+", "", normalize_name(value)).casefold()


def marker_name_set(value: Any, defaults: tuple[str, ...]) -> set[str]:
    names = normalized_name_set(value)
    names.update(normalize_name(item).casefold() for item in defaults if normalize_name(item))
    return names


def variable_matches_markers(variable: str, marker_variables: set[str]) -> bool:
    name = normalize_name(variable).casefold()
    if name in marker_variables:
        return True
    compact = compact_marker(variable)
    if not compact:
        return False
    return any(compact_marker(item) == compact for item in marker_variables)


def shape_has_marker_variable(text: str, marker_variables: set[str]) -> bool:
    for match in TEMPLATE_VARIABLE_RE.finditer(text):
        variable = next((group for group in match.groups() if group is not None), "")
        if variable_matches_markers(variable, marker_variables):
            return True
    return False


def heading_matches_hints(text: str, hints: tuple[str, ...]) -> bool:
    compact = compact_marker(text)
    return any(hint in compact for hint in hints)


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    index = 2
    length = len(data)
    while index + 9 < length:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker == 0xFF:
            index += 1
            continue
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if index + 3 >= length:
            break
        segment_length = int.from_bytes(data[index + 2 : index + 4], "big")
        if marker in (
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        ):
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            if width > 0 and height > 0:
                return width, height
        if segment_length < 2:
            break
        index += 2 + segment_length
    return None


def image_dimensions(data: bytes) -> tuple[int, int] | None:
    if data[:2] == b"\xff\xd8":
        return jpeg_dimensions(data)
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
        if width > 0 and height > 0:
            return width, height
    return None


def contain_rect(
    cell_x: int,
    cell_y: int,
    cell_cx: int,
    cell_cy: int,
    image_width: int,
    image_height: int,
) -> tuple[int, int, int, int]:
    if image_width <= 0 or image_height <= 0 or cell_cx <= 0 or cell_cy <= 0:
        return cell_x, cell_y, max(1, cell_cx), max(1, cell_cy)
    scale = min(cell_cx / image_width, cell_cy / image_height)
    pic_cx = max(1, int(image_width * scale))
    pic_cy = max(1, int(image_height * scale))
    return (
        cell_x + (cell_cx - pic_cx) // 2,
        cell_y + (cell_cy - pic_cy) // 2,
        pic_cx,
        pic_cy,
    )


def is_asset_images_marker(text: str, marker_variables: set[str]) -> bool:
    compact = compact_marker(text)
    if ASSET_IMAGES_KEY in compact or heading_matches_hints(text, ASSET_HEADING_HINTS):
        return True
    # A company may name its marker freely, e.g. <<inspectionPhotos>>.  Its
    # mapping source is `images.asset`; keep the text placeholder visible until
    # this check so the geometry of that shape becomes the image anchor.
    return shape_has_marker_variable(text, marker_variables)


def is_section_images_marker(text: str, marker: str) -> bool:
    """Arabic section headings are optional image anchors, not required tokens."""
    return marker in compact_marker(text)


def markers_in_slide(slide_xml: str, marker_variables: set[str]) -> list[str]:
    return [
        shape.group(0)
        for shape in SHAPE_RE.finditer(slide_xml)
        if is_asset_images_marker(text_in_shape(shape.group(0)), marker_variables)
    ]


def variable_markers_in_slide(slide_xml: str, marker_variables: set[str]) -> list[str]:
    return [
        shape.group(0)
        for shape in SHAPE_RE.finditer(slide_xml)
        if shape_has_marker_variable(text_in_shape(shape.group(0)), marker_variables)
    ]


def heading_markers_in_slide(slide_xml: str, hints: tuple[str, ...]) -> list[str]:
    return [
        shape.group(0)
        for shape in SHAPE_RE.finditer(slide_xml)
        if heading_matches_hints(text_in_shape(shape.group(0)), hints)
    ]


def section_markers_in_slide(slide_xml: str, marker: str) -> list[str]:
    return [
        shape.group(0)
        for shape in SHAPE_RE.finditer(slide_xml)
        if is_section_images_marker(text_in_shape(shape.group(0)), marker)
    ]


def slide_paths(parts: dict[str, bytes]) -> list[str]:
    result: list[tuple[int, str]] = []
    for name in parts:
        match = SLIDE_PATH_RE.match(name)
        if match:
            result.append((int(match.group(1)), name))
    return [name for _number, name in sorted(result)]


def read_xml(parts: dict[str, bytes], part_name: str) -> str:
    data = parts.get(part_name)
    if data is None:
        raise RuntimeError(f"PowerPoint part is missing: {part_name}")
    return data.decode("utf-8")


def write_xml(parts: dict[str, bytes], part_name: str, value: str) -> None:
    parts[part_name] = value.encode("utf-8")


def attribute_value(tag_xml: str, name: str) -> int | None:
    match = re.search(rf"\b{re.escape(name)}=[\"'](-?\d+)[\"']", tag_xml, re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def slide_size(parts: dict[str, bytes]) -> tuple[int, int]:
    xml = read_xml(parts, "ppt/presentation.xml")
    match = re.search(r"<p:sldSz\b[^>]*>", xml, re.IGNORECASE)
    tag = match.group(0) if match else ""
    cx = attribute_value(tag, "cx") or 12192000
    cy = attribute_value(tag, "cy") or 6858000
    return (cx if cx > 0 else 12192000, cy if cy > 0 else 6858000)


def marker_placement(
    marker_shape: str, size: tuple[int, int], columns_override: int | None = None, one_per_slide: bool = False
) -> dict[str, int]:
    xfrm = re.search(r"<a:xfrm\b[^>]*>.*?</a:xfrm>", marker_shape, re.IGNORECASE | re.DOTALL)
    xfrm_xml = xfrm.group(0) if xfrm else ""
    off = re.search(r"<a:off\b[^>]*/>", xfrm_xml, re.IGNORECASE)
    ext = re.search(r"<a:ext\b[^>]*/>", xfrm_xml, re.IGNORECASE)
    marker_y = attribute_value(off.group(0), "y") if off else 0
    marker_height = attribute_value(ext.group(0), "cy") if ext else 0
    marker_y = marker_y or 0
    marker_height = marker_height or 0
    slide_cx, slide_cy = size
    side_margin = 304800
    bottom_margin = 304800
    gap = 152400
    top_gap = 152400
    start_y = min(
        max(side_margin, marker_y + marker_height + top_gap),
        max(side_margin, slide_cy - bottom_margin - 914400),
    )
    available_width = max(914400, slide_cx - side_margin * 2)
    available_height = max(914400, slide_cy - start_y - bottom_margin)
    columns = (
        max(1, min(6, columns_override))
        if columns_override is not None
        else max(1, min(3, (available_width + gap) // 1828800))
    )
    rows = 2 if available_height >= 2400000 else 1
    cx = max(457200, (available_width - gap * (columns - 1)) // columns)
    cy = max(457200, (available_height - gap * (rows - 1)) // rows)
    if one_per_slide:
        columns = 1
        rows = 1
        cx = available_width
        cy = available_height
    return {
        "x": side_margin,
        "y": start_y,
        "cx": cx,
        "cy": cy,
        "columns": columns,
        "perSlide": columns * rows,
        "gap": gap,
    }


def slide_rels_path(slide_path: str) -> str:
    return f"ppt/slides/_rels/{slide_path.rsplit('/', 1)[-1]}.rels"


def new_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    )


def next_relationship_id(rels_xml: str) -> int:
    highest = 0
    for match in re.finditer(r"\bId=[\"']rId(\d+)[\"']", rels_xml, re.IGNORECASE):
        highest = max(highest, int(match.group(1)))
    return highest + 1


def next_shape_id(slide_xml: str) -> int:
    highest = 1
    for match in re.finditer(r"<p:cNvPr\b[^>]*\bid=[\"'](\d+)[\"']", slide_xml, re.IGNORECASE):
        highest = max(highest, int(match.group(1)))
    return highest + 1


def picture_xml(
    shape_id: int,
    relationship_id: str,
    name: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
) -> str:
    return (
        "<p:pic>"
        "<p:nvPicPr>"
        f'<p:cNvPr id="{shape_id}" name="{xml_escape(name)}"/>'
        '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/>'
        "</p:nvPicPr>"
        f'<p:blipFill><a:blip r:embed="{relationship_id}"/>'
        "<a:stretch><a:fillRect/></a:stretch></p:blipFill>"
        "<p:spPr><a:xfrm>"
        f'<a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/>'
        "</a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>"
        "</p:pic>"
    )


def ensure_jpeg_content_type(parts: dict[str, bytes]) -> None:
    part_name = "[Content_Types].xml"
    xml = read_xml(parts, part_name)
    if re.search(r"<Default\s+Extension=[\"']jpeg[\"']", xml, re.IGNORECASE):
        return
    updated = re.sub(
        r"</Types>\s*$",
        '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>',
        xml,
        flags=re.IGNORECASE,
    )
    write_xml(parts, part_name, updated)


def add_images_to_slide(
    parts: dict[str, bytes],
    slide_path: str,
    slide_xml: str,
    image_paths: list[str],
    placement: dict[str, int],
    image_sequence_start: int,
    label: str,
) -> tuple[int, int]:
    rels_path = slide_rels_path(slide_path)
    rels_xml = parts.get(rels_path, new_rels_xml().encode("utf-8")).decode("utf-8")
    next_rel = next_relationship_id(rels_xml)
    next_shape = next_shape_id(slide_xml)
    sequence = image_sequence_start
    pictures: list[str] = []
    relationships: list[str] = []

    for index, image_path in enumerate(image_paths):
        image_file = Path(image_path)
        if not image_file.is_file() or image_file.stat().st_size < 32:
            continue
        data = image_file.read_bytes()
        while True:
            media_name = f"spark-vision-{label}-{sequence:05d}.jpeg"
            sequence += 1
            media_path = f"ppt/media/{media_name}"
            if media_path not in parts:
                break
        ensure_jpeg_content_type(parts)
        parts[media_path] = data
        relationship_id = f"rId{next_rel}"
        next_rel += 1
        relationships.append(
            f'<Relationship Id="{relationship_id}" Type="{IMAGE_REL_TYPE}" Target="../media/{media_name}"/>'
        )
        row = index // placement["columns"]
        column = index % placement["columns"]
        cell_x = placement["x"] + (placement["columns"] - 1 - column) * (placement["cx"] + placement["gap"])
        cell_y = placement["y"] + row * (placement["cy"] + placement["gap"])
        image_width, image_height = image_dimensions(data) or (0, 0)
        x, y, cx, cy = contain_rect(
            cell_x,
            cell_y,
            placement["cx"],
            placement["cy"],
            image_width,
            image_height,
        )
        pictures.append(
            picture_xml(
                next_shape,
                relationship_id,
                f"{label.title()} image {index + 1}",
                x,
                y,
                cx,
                cy,
            )
        )
        next_shape += 1

    if not pictures:
        return (0, sequence)
    tree_close = "</p:spTree>"
    at = slide_xml.rfind(tree_close)
    if at < 0:
        raise RuntimeError("The PowerPoint slide has no shape tree for image insertion.")
    output_slide = slide_xml[:at] + "".join(pictures) + slide_xml[at:]
    output_rels = re.sub(
        r"</Relationships>\s*$",
        "".join(relationships) + "</Relationships>",
        rels_xml,
        flags=re.IGNORECASE,
    )
    write_xml(parts, slide_path, output_slide)
    write_xml(parts, rels_path, output_rels)
    return (len(pictures), sequence)


def next_slide_number(parts: dict[str, bytes]) -> int:
    numbers = [int(match.group(1)) for name in parts if (match := SLIDE_PATH_RE.match(name))]
    return (max(numbers) if numbers else 0) + 1


def append_slide_content_type(parts: dict[str, bytes], slide_number: int) -> None:
    part_name = "[Content_Types].xml"
    xml = read_xml(parts, part_name)
    target = f"/ppt/slides/slide{slide_number}.xml"
    if f'PartName="{target}"' in xml:
        return
    xml = re.sub(
        r"</Types>\s*$",
        f'<Override PartName="{target}" ContentType="{SLIDE_CONTENT_TYPE}"/></Types>',
        xml,
        flags=re.IGNORECASE,
    )
    write_xml(parts, part_name, xml)


def insert_presentation_slide_after(
    parts: dict[str, bytes],
    after_slide_path: str,
    new_slide_number: int,
) -> None:
    """Insert a slide immediately after ``after_slide_path`` in presentation order.

    Overflow image pages must follow their section (Word-style), not jump to
    the end of the deck past later annex slides.
    """
    presentation_part = "ppt/presentation.xml"
    rels_part = "ppt/_rels/presentation.xml.rels"
    presentation_xml = read_xml(parts, presentation_part)
    rels_xml = read_xml(parts, rels_part)
    after_file = after_slide_path.rsplit("/", 1)[-1].casefold()
    after_rid = ""
    for match in re.finditer(r"<Relationship\b[^>]*/?>", rels_xml, re.IGNORECASE):
        tag = match.group(0)
        target_match = re.search(r"\bTarget=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
        id_match = re.search(r"\bId=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
        type_match = re.search(r"\bType=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
        if not target_match or not id_match:
            continue
        target = target_match.group(1).replace("\\", "/").rsplit("/", 1)[-1].casefold()
        if target != after_file:
            continue
        if type_match and "slide" not in type_match.group(1).casefold():
            continue
        after_rid = id_match.group(1)
        break
    highest_slide_id = 255
    for match in re.finditer(r"<p:sldId\b[^>]*\bid=[\"'](\d+)[\"']", presentation_xml, re.IGNORECASE):
        highest_slide_id = max(highest_slide_id, int(match.group(1)))
    relationship_id = f"rId{next_relationship_id(rels_xml)}"
    new_sld = f'<p:sldId id="{highest_slide_id + 1}" r:id="{relationship_id}"/>'
    inserted = 0
    if after_rid:
        presentation_xml, inserted = re.subn(
            rf"(<p:sldId\b[^>]*\br:id=[\"']{re.escape(after_rid)}[\"'][^/]*/>)",
            rf"\1{new_sld}",
            presentation_xml,
            count=1,
            flags=re.IGNORECASE,
        )
    if inserted == 0:
        if not re.search(r"<p:sldIdLst\b", presentation_xml, re.IGNORECASE):
            raise RuntimeError("The PowerPoint presentation has no valid slide list.")
        presentation_xml = re.sub(
            r"</p:sldIdLst>",
            f"{new_sld}</p:sldIdLst>",
            presentation_xml,
            count=1,
            flags=re.IGNORECASE,
        )
    rels_xml = re.sub(
        r"</Relationships>\s*$",
        f'<Relationship Id="{relationship_id}" Type="{SLIDE_REL_TYPE}" Target="slides/slide{new_slide_number}.xml"/></Relationships>',
        rels_xml,
        flags=re.IGNORECASE,
    )
    write_xml(parts, presentation_part, presentation_xml)
    write_xml(parts, rels_part, rels_xml)
    append_slide_content_type(parts, new_slide_number)

    app_part = "docProps/app.xml"
    if app_part in parts:
        app_xml = read_xml(parts, app_part)
        count = len(slide_paths(parts))
        app_xml = re.sub(r"<Slides>\d+</Slides>", f"<Slides>{count}</Slides>", app_xml, flags=re.IGNORECASE)
        app_xml = re.sub(
            r"(<vt:lpstr>Slides</vt:lpstr></vt:variant>\s*<vt:variant><vt:i4>)\d+(</vt:i4>)",
            rf"\g<1>{count}\g<2>",
            app_xml,
            flags=re.IGNORECASE,
        )
        write_xml(parts, app_part, app_xml)


def merge(manifest: dict[str, Any]) -> dict[str, Any]:
    template_path = Path(str(manifest.get("templatePath") or ""))
    output_path = Path(str(manifest.get("outputPath") or ""))
    if not template_path.is_file():
        raise RuntimeError("PowerPoint template file is missing.")
    if not output_path.parent.is_dir():
        output_path.parent.mkdir(parents=True, exist_ok=True)
    raw_values = manifest.get("textValues")
    values = {
        str(key): str(value if value is not None else "")
        for key, value in (raw_values.items() if isinstance(raw_values, dict) else [])
    }
    asset_image_paths = [str(path) for path in manifest.get("assetImagePaths", []) if isinstance(path, str)]
    valuation_image_paths = [str(path) for path in manifest.get("valuationImagePaths", []) if isinstance(path, str)]
    client_image_paths = [str(path) for path in manifest.get("clientImagePaths", []) if isinstance(path, str)]
    certificate_image_paths = [str(path) for path in manifest.get("certificateImagePaths", []) if isinstance(path, str)]
    raw_layout = manifest.get("imageLayout")
    image_layout = raw_layout if isinstance(raw_layout, dict) else {}
    def layout_columns(name: str, fallback: int) -> int:
        try:
            return max(1, min(6, int(image_layout.get(name, fallback))))
        except (TypeError, ValueError):
            return fallback
    asset_columns = layout_columns("assetImagesPerRow", 3)
    client_columns = layout_columns("clientImagesPerRow", 2)
    excluded_variable_names = normalized_name_set(manifest.get("excludedVariableNames"))
    asset_image_marker_variables = marker_name_set(
        manifest.get("assetImageMarkerVariables"),
        DEFAULT_ASSET_IMAGE_MARKERS,
    )
    valuation_image_marker_variables = marker_name_set(
        manifest.get("valuationImageMarkerVariables"),
        DEFAULT_VALUATION_IMAGE_MARKERS,
    )
    client_image_marker_variables = marker_name_set(
        manifest.get("clientImageMarkerVariables"),
        DEFAULT_CLIENT_IMAGE_MARKERS,
    )
    certificate_image_marker_variables = marker_name_set(
        manifest.get("certificateImageMarkerVariables"),
        DEFAULT_CERTIFICATE_IMAGE_MARKERS,
    )
    for marker_name in (
        asset_image_marker_variables
        | valuation_image_marker_variables
        | client_image_marker_variables
        | certificate_image_marker_variables
    ):
        excluded_variable_names.add(marker_name)

    with zipfile.ZipFile(template_path, "r") as source:
        parts = {
            info.filename: source.read(info.filename)
            for info in source.infolist()
            if not info.is_dir()
        }

    initial_slide_paths = slide_paths(parts)
    if not initial_slide_paths:
        raise RuntimeError("The PowerPoint template contains no slides.")
    stats: dict[str, Any] = {
        "variablesFound": set(),
        "variablesFilled": 0,
        "assetImagesInserted": 0,
        "assetImageMarkers": 0,
        "valuationImagesInserted": 0,
        "valuationImageMarkers": 0,
        "clientImagesInserted": 0,
        "clientImageMarkers": 0,
        "certificateImagesInserted": 0,
        "certificateImageMarkers": 0,
        "slidesAdded": 0,
        "warnings": [],
    }
    image_kinds = (
        ("asset", asset_image_marker_variables, ASSET_HEADING_HINTS),
        ("valuation", valuation_image_marker_variables, VALUATION_HEADING_HINTS),
        ("client", client_image_marker_variables, CLIENT_HEADING_HINTS),
        ("certificate", certificate_image_marker_variables, CERTIFICATE_HEADING_HINTS),
    )
    variable_targets: dict[str, dict[str, str]] = {}
    heading_targets: dict[str, dict[str, str]] = {}
    for slide_path in initial_slide_paths:
        original_xml = read_xml(parts, slide_path)
        updated_xml = replace_variables_in_slide(
            original_xml,
            values,
            stats,
            excluded_variable_names,
        )
        write_xml(parts, slide_path, updated_xml)
        rels_xml = parts.get(slide_rels_path(slide_path), new_rels_xml().encode("utf-8")).decode("utf-8")
        for kind, marker_variables, heading_hints in image_kinds:
            variable_shapes = variable_markers_in_slide(updated_xml, marker_variables)
            heading_shapes = heading_markers_in_slide(updated_xml, heading_hints)
            stats[f"{kind}ImageMarkers"] += len(variable_shapes) + len(heading_shapes)
            target_payload = {
                "slidePath": slide_path,
                "slideXml": updated_xml,
                "relsXml": rels_xml,
            }
            if variable_shapes:
                variable_targets[kind] = {**target_payload, "marker": variable_shapes[0]}
            elif heading_shapes:
                heading_targets[kind] = {**target_payload, "marker": heading_shapes[0]}

    targets: dict[str, dict[str, str]] = {**heading_targets, **variable_targets}
    marker_variables_by_kind = {
        "asset": asset_image_marker_variables,
        "valuation": valuation_image_marker_variables,
        "client": client_image_marker_variables,
        "certificate": certificate_image_marker_variables,
    }
    for kind, target in targets.items():
        if kind not in variable_targets:
            continue
        current_xml = read_xml(parts, target["slidePath"])
        cleared_xml = clear_marker_variables_in_slide(
            current_xml,
            marker_variables_by_kind[kind],
        )
        write_xml(parts, target["slidePath"], cleared_xml)
        for other in targets.values():
            if other["slidePath"] == target["slidePath"]:
                other["slideXml"] = cleared_xml

    def insert_image_group(
        kind: str, paths: list[str], columns: int, one_per_slide: bool = False
    ) -> None:
        valid_paths = [path for path in paths if Path(path).is_file() and Path(path).stat().st_size >= 32]
        skipped = len(paths) - len(valid_paths)
        if skipped:
            stats["warnings"].append(f"Skipped {skipped} unreadable {kind} image(s).")
        target = targets.get(kind)
        if target is None or not valid_paths:
            return
        placement = marker_placement(
            target["marker"], slide_size(parts), columns_override=columns, one_per_slide=one_per_slide
        )
        last_slide_path = target["slidePath"]
        sequence = 1
        for chunk_start in range(0, len(valid_paths), placement["perSlide"]):
            chunk = valid_paths[chunk_start : chunk_start + placement["perSlide"]]
            if chunk_start == 0:
                current_slide_path = target["slidePath"]
                current_slide_xml = target["slideXml"]
            else:
                number = next_slide_number(parts)
                current_slide_path = f"ppt/slides/slide{number}.xml"
                current_slide_xml = target["slideXml"]
                write_xml(parts, current_slide_path, current_slide_xml)
                write_xml(parts, slide_rels_path(current_slide_path), target["relsXml"])
                insert_presentation_slide_after(parts, last_slide_path, number)
                stats["slidesAdded"] += 1
            inserted, sequence = add_images_to_slide(
                parts, current_slide_path, current_slide_xml, chunk, placement, sequence, kind
            )
            stats[f"{kind}ImagesInserted"] += inserted
            last_slide_path = current_slide_path

    if asset_image_paths and "asset" not in targets:
        stats["warnings"].append("No asset-image marker was found in the PowerPoint template.")
    # Missing Arabic headings are intentionally silent: the sections are optional.
    insert_image_group("asset", asset_image_paths, asset_columns)
    insert_image_group("valuation", valuation_image_paths, 1, one_per_slide=True)
    insert_image_group("client", client_image_paths, client_columns)
    insert_image_group("certificate", certificate_image_paths, client_columns)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for name, data in parts.items():
            output.writestr(name, data)

    stats["variablesFound"] = sorted(stats["variablesFound"])
    return stats


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("Expected a JSON manifest path.")
    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stats = merge(manifest)
    print(json.dumps(stats, ensure_ascii=True), file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"pptx-worker error: {error}", file=sys.stderr)
        raise
