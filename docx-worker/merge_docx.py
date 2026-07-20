#!/usr/bin/env python3
"""
دمج تقرير Word عبر الإشارات المرجعية (Bookmarks) — lxml.
Usage: python merge_docx.py < payload.json > output.docx
"""

from __future__ import annotations

import base64
import io
import json
import math
import posixpath
import re
import sys
import traceback
import zipfile
from copy import deepcopy
from typing import Any

from lxml import etree
from PIL import Image

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_NS = "http://www.w3.org/XML/1998/namespace"

TEXT_BOOKMARKS: dict[str, list[str]] = {
    "reportTitle": ["عنوان", "عنوانغ", "غلاف", "عنواناصل"],
    "clientName": ["عميل", "عميلاستخدام", "عميلغلاف"],
    "clientIdentity": ["عميلهوية"],
    "valuationBasis": ["اساس", "أساس", "اساسالقيمة", "أساسالقيمة"],
    "valuationPurpose": ["الغرض", "غرضالتقييم"],
    "agreementDate": [
        "تاريخاتفاق",
        "تاريخالاتفاق",
        "تاريخاتفاقية",
        "تاريخالاتفاقية",
        "تاريخالتعاقد",
        "تاريخاتفاقتاريخاصدار",
    ],
    "reportIssueDate": [
        "تاريخاصدار",
        "تاريخالإصدار",
        "تاريخاصدارالتقرير",
        "تاريخإصدارالتقرير",
        "تاريخالتقرير",
    ],
    "valuationDate": ["تاريختقييم", "تاريختقييمت", "تاريختقييمق", "تاريخالتقييم"],
    "inspectionDate": ["تاريخمعاين", "تاريخمعاينة", "تاريخالمعاين", "تاريخالمعاينة", "تاريخفحص", "تاريخالفحص"],
    "valuePremise": ["فرضية", "فرضية1"],
    "finalValue": ["قيمةنهائية", "قيمة", "القيمة", "رأيالقيمة", "رايالقيمة"],
    "finalValueAmount": ["قيمةرقم", "رقمالقيمة", "قيمةعدد", "رأيالقيمةرقم"],
    "finalValueWords": ["قيمةاحرف"],
    "inspectionLocation": ["موقع"],
    "inspectionMapUrl": ["قوقل"],
}

IMAGE_BOOKMARKS: dict[str, dict[str, Any]] = {
    "صوراصول": {"field": "asset", "layout": "paged_grid3", "remove_placeholder": True},
    "صورحسابات": {"field": "valuation", "layout": "paged_grid3", "remove_placeholder": True},
}

MERGE_PARTS_RE = re.compile(r"^word/(document|header\d+|footer\d+)\.xml$", re.I)
ASSET_IMAGE_PAGE_TITLE = "مرفق 2: الصور الفوتوغرافية"
IMAGE_PAGE_TITLE = ASSET_IMAGE_PAGE_TITLE
IMAGES_PER_ROW = 4
IMAGES_PER_PAGE = 20
IMAGE_ROWS_PER_PAGE = math.ceil(IMAGES_PER_PAGE / IMAGES_PER_ROW)
EMU_PER_INCH = 914400
PIXEL_DXA = 15
PIXEL_EMU = int(EMU_PER_INCH / 96)
IMAGE_HORIZONTAL_MARGIN_PX = 3
IMAGE_HORIZONTAL_MARGIN_DXA = PIXEL_DXA * IMAGE_HORIZONTAL_MARGIN_PX
IMAGE_HORIZONTAL_MARGIN_EMU = PIXEL_EMU * IMAGE_HORIZONTAL_MARGIN_PX
IMAGE_CONTENT_WIDTH_RATIO = 0.95
ASSET_IMAGE_GAP_DXA = IMAGE_HORIZONTAL_MARGIN_DXA
ASSET_IMAGE_GAP_EMU = IMAGE_HORIZONTAL_MARGIN_EMU
# خلية صور الأصول لا تتجاوز عرضها ~2 بوصة في التقرير؛ 900px تكفي لطباعة حادة حتى عند 400dpi
# (900/2 = 450dpi) بينما تقلّص زمن فك/إعادة ترميز الصورة وحجم ملف الـ docx الناتج جذرياً مقارنة
# بإبقاء دقة كاميرا الهاتف الكاملة (غالباً 3000-4000px) لكل صورة — الفارق الرئيسي في بطء الدمج
# مع مشاريع بها مئات الصور.
ASSET_IMAGE_MAX_SQUARE_PX = 900
# صور التقييم أقل عدداً لكنها تُعرض بعرض يصل لـ90% من الصفحة؛ سقف أعلى يحفظ الوضوح.
VALUATION_IMAGE_MAX_DIMENSION_PX = 1800
DEFAULT_PAGE_WIDTH_EMU = int(8.27 * EMU_PER_INCH)
DEFAULT_PAGE_HEIGHT_EMU = int(11.69 * EMU_PER_INCH)
DEFAULT_PAGE_MARGIN_EMU = int(0.5 * EMU_PER_INCH)
COVER_BOOKMARK_FONT_FAMILY = "Tajawal"
ARABIC_RE = re.compile(r"[\u0600-\u06ff]")
MOJIBAKE_RE = re.compile(r"[ØÙÃÂÐÑ]")


def w(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def set_w_attrs(el: etree._Element, attrs: dict[str, Any]) -> etree._Element:
    for key, value in attrs.items():
        el.set(w(key), str(value))
    return el


def log(msg: str) -> None:
    try:
        sys.stderr.buffer.write((msg + "\n").encode("utf-8"))
        sys.stderr.buffer.flush()
    except Exception:
        print(msg, file=sys.stderr)


def normalize_bookmark_name(name: str) -> str:
    cleaned = re.sub(r"[\u200e\u200f\u202a-\u202e]", "", repair_mojibake_text(name or ""))
    return re.sub(r"[\s_\-.،؛:\u060c\u061b\u0640]+", "", cleaned).strip().lower()


def arabic_score(value: str) -> int:
    return len(ARABIC_RE.findall(value or ""))


def mojibake_score(value: str) -> int:
    return len(MOJIBAKE_RE.findall(value or ""))


def repair_mojibake_text(value: str) -> str:
    """Repairs Arabic UTF-8 text that was decoded as cp1252/latin-1 before merge."""
    original = str(value or "")
    if not original or mojibake_score(original) == 0:
        return original

    candidates: list[str] = []
    for encoding in ("cp1252", "latin1"):
        try:
            candidates.append(original.encode(encoding).decode("utf-8"))
        except Exception:
            continue

    best = original
    best_key = (arabic_score(original), -mojibake_score(original))
    for candidate in candidates:
        key = (arabic_score(candidate), -mojibake_score(candidate))
        if key > best_key:
            best = candidate
            best_key = key
    return best


def sanitize_xml_text(value: str, strip: bool = True) -> str:
    """يزيل محارف UTF-16 surrogate ومحارف التحكم — lxml يرفضها."""
    if not value:
        return ""
    cleaned = re.sub(r"[\uD800-\uDFFF]", "", repair_mojibake_text(str(value)))
    cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]", "", cleaned)
    return cleaned.strip() if strip else cleaned


def build_name_to_text(text_values: dict[str, str], text_by_name: dict[str, str]) -> dict[str, str]:
    out = {
        k: sanitize_xml_text(v)
        for k, v in text_by_name.items()
        if v and sanitize_xml_text(str(v))
    }
    for field, names in TEXT_BOOKMARKS.items():
        val = sanitize_xml_text(str(text_values.get(field, "")))
        if not val:
            continue
        for name in names:
            out.setdefault(name, val)
    return out


CONTEXTUAL_TEXT_RULES: list[dict[str, Any]] = [
    {
        "field": "clientName",
        "before": ["والعميل"],
        "after": ["حسب نطاق"],
    },
    {
        "field": "valuationPurpose",
        "before": ["لغرض"],
        "after": ["على أساس"],
    },
    {
        "field": "valuationBasis",
        "before": ["على أساس"],
        "after": ["في تاريخ التقييم"],
    },
    {
        "field": "valuationDate",
        "before": ["في تاريخ التقييم"],
        "after": [""],
        "normalize_existing": True,
    },
    {
        "field": "valuationDate",
        "before": ["تاريخ التقييم هو"],
        "after": ["م.", "م"],
        "normalize_existing": True,
    },
    {
        "field": "valuationDate",
        "before": ["تاريخ التقييم"],
        "after": ["م.", "م"],
        "not_contains": ["تاريخ التقييم هو"],
        "normalize_existing": True,
    },
    {
        "field": "agreementDate",
        "before": ["تاريخ الاتفاقية", "تاريخ اتفاقية"],
        "after": ["م.", "م"],
        "normalize_existing": True,
    },
    {
        "field": "inspectionDate",
        "before": ["تاريخ المعاينة", "تاريخ معاينة"],
        "after": ["م.", "م"],
        "normalize_existing": True,
    },
    {
        "field": "reportIssueDate",
        "before": ["تاريخ إصدار التقرير", "تاريخ اصدار التقرير", "تاريخ الإصدار", "تاريخ الاصدار"],
        "after": ["م.", "م"],
        "normalize_existing": True,
    },
    {
        "field": "clientIdentity",
        "before": ["العميل هو"],
        "after": ["ونوعها"],
    },
    {
        "field": "valuationPurpose",
        "before": ["نطاق التقييم هو"],
        "after": ["حيث أن الغرض"],
    },
    {
        "field": "clientName",
        "before": ["للمستخدمين المقتصرين وهم العميل"],
        "after": ["ومركز"],
    },
    {
        "field": "inspectionLocation",
        "before": ["مدينة"],
        "after": ["،", ","],
        "contains": ["تمت المعاينة"],
        "normalize_existing": True,
    },
    {
        "field": "inspectionDate",
        "before": ["بتاريخ"],
        "after": ["م.", "م"],
        "contains": ["تمت المعاينة"],
        "normalize_existing": True,
        "overwrite": True,
    },
    {
        "field": "finalValueAmount",
        "before": ["("],
        "after": ["ر.س", "ر.س.", "ريال"],
        "contains": ["رأي قيمة"],
        "overwrite": True,
    },
]


def is_image_bookmark(name: str) -> bool:
    norm = normalize_bookmark_name(name)
    return any(normalize_bookmark_name(k) == norm for k in IMAGE_BOOKMARKS)


def paragraph_bookmark_names(para: etree._Element) -> list[str]:
    return [bm.get(w("name")) or "" for bm in para.iter(w("bookmarkStart"))]


def should_skip_text_bookmark_fill(name: str, start: etree._Element) -> bool:
    norm = normalize_bookmark_name(name)
    if norm != normalize_bookmark_name("تاريختقييمت"):
        return False
    para = find_ancestor(start, w("p"))
    if para is None:
        return False
    names = [normalize_bookmark_name(item) for item in paragraph_bookmark_names(para)]
    para_text = normalize_bookmark_name("".join(t.text or "" for t in para.iter(w("t"))))
    return (
        normalize_bookmark_name("تاريخمعاين") in names
        and "معاين" in para_text
        and "بتاريخ" in para_text
    )


def text_nodes_with_offsets(container: etree._Element) -> tuple[list[tuple[etree._Element, int, int]], str]:
    nodes: list[tuple[etree._Element, int, int]] = []
    parts: list[str] = []
    offset = 0
    for node in container.iter(w("t")):
        text = sanitize_xml_text(node.text or "", strip=False)
        node.text = text
        parts.append(text)
        start = offset
        offset += len(text)
        nodes.append((node, start, offset))
    return nodes, "".join(parts)


def set_text_preserve_space(node: etree._Element, text: str) -> None:
    node.text = sanitize_xml_text(text, strip=False)
    if node.text and (node.text[:1].isspace() or node.text[-1:].isspace()):
        node.set(f"{{{XML_NS}}}space", "preserve")


def replace_text_range(
    nodes: list[tuple[etree._Element, int, int]],
    start: int,
    end: int,
    replacement: str,
) -> bool:
    if start < 0 or end < start or not nodes:
        return False
    safe = sanitize_xml_text(replacement, strip=False)
    inserted = False

    for node, node_start, node_end in nodes:
        text = node.text or ""
        if start == end and node_start <= start <= node_end:
            local = start - node_start
            set_text_preserve_space(node, text[:local] + safe + text[local:])
            return True
        if node_end <= start or node_start >= end:
            continue

        overlap_start = max(start, node_start)
        overlap_end = min(end, node_end)
        prefix = text[: max(0, overlap_start - node_start)] if node_start <= start <= node_end else ""
        suffix = text[max(0, overlap_end - node_start) :] if node_start <= end <= node_end else ""

        if not inserted:
            set_text_preserve_space(node, prefix + safe + suffix)
            inserted = True
        else:
            set_text_preserve_space(node, suffix)

    return inserted


def find_after_token(full_text: str, tokens: list[str], start: int) -> tuple[int, str] | None:
    candidates: list[tuple[int, str]] = []
    for token in tokens:
        if token == "":
            candidates.append((len(full_text), token))
            continue
        idx = full_text.find(token, start)
        if idx >= 0:
            candidates.append((idx, token))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[0])


def apply_contextual_rule_to_paragraph(
    para: etree._Element,
    rule: dict[str, Any],
    text_values: dict[str, str],
) -> bool:
    field = str(rule.get("field") or "")
    value = sanitize_xml_text(str(text_values.get(field, "")))
    if not field or not value:
        return False

    nodes, full_text = text_nodes_with_offsets(para)
    if not full_text:
        return False
    required_texts = [sanitize_xml_text(str(item), strip=False) for item in rule.get("contains", [])]
    if any(required and required not in full_text for required in required_texts):
        return False
    blocked_texts = [sanitize_xml_text(str(item), strip=False) for item in rule.get("not_contains", [])]
    if any(blocked and blocked in full_text for blocked in blocked_texts):
        return False

    for before in rule.get("before", []):
        before = sanitize_xml_text(str(before), strip=False)
        before_idx = full_text.find(before)
        if before_idx < 0:
            continue
        value_start = before_idx + len(before)
        after_match = find_after_token(full_text, [str(item) for item in rule.get("after", [])], value_start)
        if after_match is None:
            continue
        value_end, _after = after_match
        if value_end < value_start:
            continue

        current = full_text[value_start:value_end]
        replacement = f" {value} "
        if value in current:
            if rule.get("normalize_existing") and current != replacement:
                return replace_text_range(nodes, value_start, value_end, replacement)
            return False
        if current.strip() and not rule.get("overwrite"):
            continue
        return replace_text_range(nodes, value_start, value_end, replacement)

    return False


def apply_contextual_text_fallbacks(root: etree._Element, text_values: dict[str, str]) -> int:
    filled = 0
    clean_values = {key: sanitize_xml_text(str(value)) for key, value in text_values.items() if value}
    for para in root.iter(w("p")):
        for rule in CONTEXTUAL_TEXT_RULES:
            if apply_contextual_rule_to_paragraph(para, rule, clean_values):
                filled += 1
    return filled


def normalize_numeric_date_suffixes(root: etree._Element) -> None:
    """Remove the Arabic Gregorian suffix after dates already rendered as DD/MM/YYYY."""
    pattern = re.compile(r"(\d{2}/\d{2}/\d{4})\s*م\.?")
    for para in root.iter(w("p")):
        nodes, full_text = text_nodes_with_offsets(para)
        matches = list(pattern.finditer(full_text))
        for match in reversed(matches):
            replace_text_range(nodes, match.start(), match.end(), match.group(1))


def find_bookmark_pairs(root: etree._Element) -> list[tuple[str, str, etree._Element, etree._Element]]:
    ends: dict[str, etree._Element] = {}
    for el in root.iter(w("bookmarkEnd")):
        bid = el.get(w("id"))
        if bid:
            ends[bid] = el

    pairs: list[tuple[str, str, etree._Element, etree._Element]] = []
    for start in root.iter(w("bookmarkStart")):
        bid = start.get(w("id"))
        name = start.get(w("name")) or ""
        if bid and bid in ends:
            pairs.append((name, bid, start, ends[bid]))
    return pairs


def find_ancestor(el: etree._Element | None, tag: str) -> etree._Element | None:
    while el is not None:
        if el.tag == tag:
            return el
        el = el.getparent()
    return None


def _rpr_from_run(run: etree._Element | None) -> etree._Element | None:
    if run is None or run.tag != w("r"):
        return None
    for child in run:
        if child.tag == w("rPr"):
            return deepcopy(child)
    return None


def copy_rpr_near(start: etree._Element) -> etree._Element | None:
    """Prefer the nearest surrounding run style so inline bookmarks (عنوانغ / عنواناصل)
    match the sentence they sit in instead of a distant first-run or cover style.
    """
    para = find_ancestor(start, w("p"))
    run = start.getparent()
    while run is not None and run is not para:
        if run.tag == w("r"):
            own = _rpr_from_run(run)
            if own is not None:
                return own
            break
        run = run.getparent()
    if para is None:
        return None

    # Nearest previous / next sibling run with rPr (typical body sentence context)
    node: etree._Element | None = start
    while node is not None and node is not para:
        prev = node.getprevious()
        while prev is not None:
            if prev.tag == w("r"):
                found = _rpr_from_run(prev)
                if found is not None:
                    return found
            prev = prev.getprevious()
        node = node.getparent()

    node = start
    while node is not None and node is not para:
        nxt = node.getnext()
        while nxt is not None:
            if nxt.tag == w("r"):
                found = _rpr_from_run(nxt)
                if found is not None:
                    return found
            nxt = nxt.getnext()
        node = node.getparent()

    ppr = para.find(w("pPr"))
    if ppr is not None:
        rpr = ppr.find(w("rPr"))
        if rpr is not None:
            return deepcopy(rpr)
    for run_el in para.findall(w("r")):
        found = _rpr_from_run(run_el)
        if found is not None:
            return found
    return None


def remove_between(start: etree._Element, end: etree._Element) -> None:
    node = start.getnext()
    while node is not None and node is not end:
        nxt = node.getnext()
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)
        node = nxt


def direct_child_under(parent: etree._Element, el: etree._Element) -> etree._Element | None:
    node = el
    while node.getparent() is not None and node.getparent() is not parent:
        node = node.getparent()
    return node if node.getparent() is parent else None


def remove_after_until(node: etree._Element, boundary: etree._Element) -> None:
    current: etree._Element | None = node
    while current is not None and current is not boundary:
        nxt = current.getnext()
        while nxt is not None:
            doomed = nxt
            nxt = nxt.getnext()
            parent = doomed.getparent()
            if parent is not None:
                parent.remove(doomed)
        current = current.getparent()


def remove_before_until(node: etree._Element, boundary: etree._Element) -> None:
    current: etree._Element | None = node
    while current is not None and current is not boundary:
        prev = current.getprevious()
        while prev is not None:
            doomed = prev
            prev = prev.getprevious()
            parent = doomed.getparent()
            if parent is not None:
                parent.remove(doomed)
        current = current.getparent()


def remove_exclusive_siblings(first: etree._Element, last: etree._Element) -> bool:
    node = first.getnext()
    doomed_nodes: list[etree._Element] = []
    while node is not None:
        if node is last:
            for doomed in doomed_nodes:
                parent = doomed.getparent()
                if parent is not None:
                    parent.remove(doomed)
            return True
        doomed_nodes.append(node)
        node = node.getnext()
    return False


def remove_between_within_boundary(
    start: etree._Element,
    end: etree._Element,
    boundary: etree._Element,
) -> bool:
    if start.getparent() is end.getparent():
        remove_between(start, end)
        return True

    start_child = direct_child_under(boundary, start)
    end_child = direct_child_under(boundary, end)
    if start_child is None or end_child is None:
        return False

    if start_child is end_child:
        return remove_between_within_boundary(start, end, start_child)

    if not remove_exclusive_siblings(start_child, end_child):
        return False

    remove_after_until(start, start_child)
    remove_before_until(end, end_child)
    return True


def remove_between_across_paragraphs(
    start: etree._Element,
    end: etree._Element,
    start_para: etree._Element,
    end_para: etree._Element,
) -> bool:
    if start_para.getparent() is None or start_para.getparent() is not end_para.getparent():
        return False
    if not remove_exclusive_siblings(start_para, end_para):
        return False
    remove_after_until(start, start_para)
    remove_before_until(end, end_para)
    return True


def make_text_run(text: str, rpr: etree._Element | None) -> etree._Element:
    run = etree.Element(w("r"))
    if rpr is not None:
        run.append(rpr)
    t = etree.SubElement(run, w("t"))
    t.text = sanitize_xml_text(text)
    t.set(f"{{{XML_NS}}}space", "preserve")
    return run


def remove_w_children(parent: etree._Element, tag: str) -> None:
    for child in list(parent.findall(w(tag))):
        parent.remove(child)


def set_rpr_value(rpr: etree._Element, tag: str, attrs: dict[str, str]) -> None:
    remove_w_children(rpr, tag)
    node = etree.SubElement(rpr, w(tag))
    for key, value in attrs.items():
        node.set(w(key), value)


def set_rpr_flag(rpr: etree._Element, tag: str) -> None:
    remove_w_children(rpr, tag)
    etree.SubElement(rpr, w(tag))


def clear_rpr_flags(rpr: etree._Element, *tags: str) -> None:
    for tag in tags:
        remove_w_children(rpr, tag)


def set_paragraph_cover_alignment(para: etree._Element) -> None:
    ppr = para.find(w("pPr"))
    if ppr is None:
        ppr = etree.Element(w("pPr"))
        para.insert(0, ppr)
    remove_w_children(ppr, "jc")
    remove_w_children(ppr, "ind")
    remove_w_children(ppr, "bidi")
    bidi = etree.Element(w("bidi"))
    ind = etree.Element(w("ind"))
    ind.set(w("left"), "0")
    ind.set(w("right"), "0")
    jc = etree.Element(w("jc"))
    jc.set(w("val"), "center")
    rpr = ppr.find(w("rPr"))
    if rpr is not None:
        insert_at = list(ppr).index(rpr)
        ppr.insert(insert_at, bidi)
        ppr.insert(insert_at + 1, ind)
        ppr.insert(insert_at + 2, jc)
    else:
        ppr.append(bidi)
        ppr.append(ind)
        ppr.append(jc)


def set_paragraph_cover_font(para: etree._Element, font_size_half_points: int | None = None) -> None:
    ppr = para.find(w("pPr"))
    if ppr is None:
        ppr = etree.Element(w("pPr"))
        para.insert(0, ppr)
    rpr = ppr.find(w("rPr"))
    if rpr is None:
        rpr = etree.SubElement(ppr, w("rPr"))
    set_rpr_value(
        rpr,
        "rFonts",
        {
            "ascii": COVER_BOOKMARK_FONT_FAMILY,
            "hAnsi": COVER_BOOKMARK_FONT_FAMILY,
            "eastAsia": COVER_BOOKMARK_FONT_FAMILY,
            "cs": COVER_BOOKMARK_FONT_FAMILY,
            "hint": "cs",
        },
    )
    set_rpr_value(rpr, "lang", {"val": "ar-SA", "bidi": "ar-SA"})
    if font_size_half_points is not None:
        set_rpr_value(rpr, "sz", {"val": str(font_size_half_points)})
        set_rpr_value(rpr, "szCs", {"val": str(font_size_half_points)})


def cover_bookmark_font_size(bookmark_name: str) -> int | None:
    """Word stores font size in half-points (14pt => 28, 11pt => 22).

    غلاف التقرير فقط: «عنوان» و«غلاف» بحجم 14pt.
    «عنوانغ» و«عنواناصل» تظهر داخل فقرات التقرير فترث تنسيق الكلام المحيط
    (عادة ~11pt) دون فرض Tajawal/توسيط الغلاف.
    """
    norm = normalize_bookmark_name(bookmark_name)
    if norm in {
        normalize_bookmark_name("عنوان"),
        normalize_bookmark_name("غلاف"),
    }:
        return 28
    if norm in {normalize_bookmark_name(name) for name in ("عميلغلاف",)}:
        return 40
    return None


def apply_cover_bookmark_style(bookmark_name: str, start: etree._Element, rpr: etree._Element | None) -> etree._Element | None:
    norm = normalize_bookmark_name(bookmark_name)
    size = cover_bookmark_font_size(bookmark_name)
    is_regular_cover_title = norm in {
        normalize_bookmark_name("عنوان"),
        normalize_bookmark_name("غلاف"),
    }
    if size is None:
        # عناوين داخل النص (عنوانغ / عنواناصل …): أبقِ rPr المجاور كما هو ليتناسق مع الفقرة
        return rpr
    para = find_ancestor(start, w("p"))
    if para is not None:
        set_paragraph_cover_alignment(para)
        set_paragraph_cover_font(para, size)
    styled = deepcopy(rpr) if rpr is not None else etree.Element(w("rPr"))
    set_rpr_value(
        styled,
        "rFonts",
        {
            "ascii": COVER_BOOKMARK_FONT_FAMILY,
            "hAnsi": COVER_BOOKMARK_FONT_FAMILY,
            "eastAsia": COVER_BOOKMARK_FONT_FAMILY,
            "cs": COVER_BOOKMARK_FONT_FAMILY,
            "hint": "cs",
        },
    )
    set_rpr_value(styled, "lang", {"val": "ar-SA", "bidi": "ar-SA"})
    set_rpr_value(styled, "sz", {"val": str(size)})
    set_rpr_value(styled, "szCs", {"val": str(size)})
    if is_regular_cover_title:
        clear_rpr_flags(styled, "b", "bCs")
    else:
        set_rpr_flag(styled, "b")
        set_rpr_flag(styled, "bCs")
    set_rpr_flag(styled, "rtl")
    return styled


def run_has_meaningful_content(run: etree._Element) -> bool:
    for child in run:
        if child.tag == w("rPr"):
            continue
        if child.tag == w("t") and (child.text or "").strip():
            return True
        if child.tag in (w("drawing"), w("pict"), w("tab"), w("br"), w("fldChar"), w("instrText")):
            return True
        if child.tag in (w("bookmarkStart"), w("bookmarkEnd")):
            continue
        return True
    return False


def cleanup_empty_runs(para: etree._Element) -> None:
    for run in list(para.findall(w("r"))):
        if not run_has_meaningful_content(run):
            has_bookmark = any(
                c.tag in (w("bookmarkStart"), w("bookmarkEnd")) for c in run
            )
            if not has_bookmark:
                parent = run.getparent()
                if parent is not None:
                    parent.remove(run)


def insert_text_before_bookmark_end(
    end: etree._Element, text: str, rpr: etree._Element | None
) -> None:
    safe = sanitize_xml_text(text)
    if end.getparent() is not None and end.getparent().tag == w("r"):
        run = end.getparent()
        if rpr is not None:
            existing = run.find(w("rPr"))
            if existing is not None:
                run.remove(existing)
            run.insert(0, deepcopy(rpr))
        t = etree.Element(w("t"))
        t.text = safe
        t.set(f"{{{XML_NS}}}space", "preserve")
        end.addprevious(t)
        return
    end.addprevious(make_text_run(safe, rpr))


def replace_text_bookmark(start: etree._Element, end: etree._Element, text: str, bookmark_name: str = "") -> bool:
    safe = sanitize_xml_text(text)
    if not safe:
        return False

    rpr = apply_cover_bookmark_style(bookmark_name, start, copy_rpr_near(start))
    start_para = find_ancestor(start, w("p"))
    end_para = find_ancestor(end, w("p"))

    removed = False
    if start_para is not None and start_para is end_para:
        removed = remove_between_within_boundary(start, end, start_para)
    elif start_para is not None and end_para is not None:
        removed = remove_between_across_paragraphs(start, end, start_para, end_para)

    if not removed and start.getparent() is end.getparent():
        remove_between(start, end)

    insert_text_before_bookmark_end(end, safe, rpr)
    if start_para is not None:
        cleanup_empty_runs(start_para)
    if end_para is not None and end_para is not start_para:
        cleanup_empty_runs(end_para)
    return True


def validate_part_xml(xml_bytes: bytes, part_name: str) -> None:
    root = etree.fromstring(xml_bytes)

    def nested_run_is_embedded_story(nested: etree._Element, outer: etree._Element) -> bool:
        """Text boxes inside drawings store their own w:p/w:r tree inside an outer run."""
        saw_paragraph = False
        node = nested.getparent()
        while node is not None and node is not outer:
            if node.tag == w("txbxContent"):
                return True
            if node.tag == w("p"):
                saw_paragraph = True
            if saw_paragraph and node.tag in (w("drawing"), w("pict")):
                return True
            node = node.getparent()
        return False

    for run in root.iter(w("r")):
        for nested in run.iter(w("r")):
            if nested is not run:
                if nested_run_is_embedded_story(nested, run):
                    continue
                raise ValueError(f"Nested runs detected in {part_name}")
    for text in root.iter(w("t")):
        if text.getparent() is None or text.getparent().tag != w("r"):
            raise ValueError(f"Orphan w:t detected in {part_name}")
    for ppr in root.iter(w("pPr")):
        children = list(ppr)
        tags = [child.tag for child in children]
        if w("jc") in tags and w("bidi") in tags and tags.index(w("jc")) < tags.index(w("bidi")):
            raise ValueError(f"Invalid paragraph property order in {part_name}: w:bidi must precede w:jc")


def collect_bookmark_names(xml_bytes: bytes) -> list[str]:
    root = etree.fromstring(xml_bytes)
    names: list[str] = []
    for _name, _bid, _s, _e in find_bookmark_pairs(root):
        if _name and _name not in names:
            names.append(_name)
    return names


def repair_text_nodes(root: etree._Element) -> None:
    for text_node in root.iter(w("t")):
        if text_node.text:
            text_node.text = sanitize_xml_text(text_node.text, strip=False)
    for instr_node in root.iter(w("instrText")):
        if instr_node.text:
            instr_node.text = sanitize_xml_text(instr_node.text, strip=False)


def apply_text_bookmarks(
    xml_bytes: bytes,
    name_to_text: dict[str, str],
    text_values: dict[str, str] | None = None,
) -> tuple[bytes, int]:
    root = etree.fromstring(xml_bytes)
    repair_text_nodes(root)
    filled = 0
    for name, _bid, start, end in find_bookmark_pairs(root):
        if is_image_bookmark(name):
            continue
        if should_skip_text_bookmark_fill(name, start):
            continue
        norm = normalize_bookmark_name(name)
        value = None
        for key, val in name_to_text.items():
            if normalize_bookmark_name(key) == norm and val and str(val).strip():
                value = str(val).strip()
                break
        if not value:
            continue
        if replace_text_bookmark(start, end, value, name):
            filled += 1

    if text_values:
        filled += apply_contextual_text_fallbacks(root, text_values)
    normalize_numeric_date_suffixes(root)

    out = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
    return out, filled


def paragraph_has_drawing(p: etree._Element) -> bool:
    return p.find(f".//{w('drawing')}") is not None or p.find(f".//{w('pict')}") is not None


def paragraph_is_placeholder_image(p: etree._Element) -> bool:
    if not paragraph_has_drawing(p):
        return False
    texts = "".join(t.text or "" for t in p.iter(w("t")))
    return not texts.strip()


def next_rid(rels_root: etree._Element) -> str:
    raw = etree.tostring(rels_root, encoding="unicode")
    ids = [int(m.group(1)) for m in re.finditer(r'Id="rId(\d+)"', raw)]
    return f"rId{(max(ids) if ids else 0) + 1}"


def next_image_path(media_paths: set[str]) -> str:
    nums = []
    for n in media_paths:
        m = re.search(r"image(\d+)", n, re.I)
        if m:
            nums.append(int(m.group(1)))
    return f"word/media/image{(max(nums) if nums else 0) + 1}.jpeg"


def ensure_jpeg(data: bytes) -> bytes:
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=88, optimize=True)
        return out.getvalue()
    except Exception:
        return data


def ensure_content_type(ct_xml: str, media_path: str) -> str:
    part = f"/{media_path}"
    if f'PartName="{part}"' in ct_xml:
        return ct_xml
    if 'Extension="jpeg"' not in ct_xml and 'Extension="jpg"' not in ct_xml:
        ct_xml = ct_xml.replace(
            "</Types>",
            '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>',
        )
    return ct_xml.replace(
        "</Types>",
        f'<Override PartName="{part}" ContentType="image/jpeg"/></Types>',
    )


def make_image_run(rid: str, cx: int, cy: int, doc_pr_id: int) -> etree._Element:
    run = etree.Element(w("r"))
    drawing = etree.SubElement(run, w("drawing"))
    inline = etree.SubElement(drawing, f"{{{WP_NS}}}inline", distT="0", distB="0", distL="0", distR="0")
    etree.SubElement(inline, f"{{{WP_NS}}}extent", cx=str(cx), cy=str(cy))
    etree.SubElement(inline, f"{{{WP_NS}}}docPr", id=str(doc_pr_id), name="Picture")
    graphic = etree.SubElement(inline, f"{{{A_NS}}}graphic")
    gd = etree.SubElement(
        graphic,
        f"{{{A_NS}}}graphicData",
        uri="http://schemas.openxmlformats.org/drawingml/2006/picture",
    )
    pic = etree.SubElement(gd, f"{{{PIC_NS}}}pic")
    nv = etree.SubElement(pic, f"{{{PIC_NS}}}nvPicPr")
    etree.SubElement(nv, f"{{{PIC_NS}}}cNvPr", id=str(doc_pr_id), name=f"Picture {doc_pr_id}")
    etree.SubElement(nv, f"{{{PIC_NS}}}cNvPicPr")
    etree.SubElement(nv, f"{{{PIC_NS}}}nvPr")
    bf = etree.SubElement(pic, f"{{{PIC_NS}}}blipFill")
    blip = etree.SubElement(bf, f"{{{A_NS}}}blip")
    blip.set(f"{{{R_NS}}}embed", rid)
    stretch = etree.SubElement(bf, f"{{{A_NS}}}stretch")
    etree.SubElement(stretch, f"{{{A_NS}}}fillRect")
    sp = etree.SubElement(pic, f"{{{PIC_NS}}}spPr")
    xf = etree.SubElement(sp, f"{{{A_NS}}}xfrm")
    etree.SubElement(xf, f"{{{A_NS}}}off", x="0", y="0")
    etree.SubElement(xf, f"{{{A_NS}}}ext", cx=str(cx), cy=str(cy))
    pg = etree.SubElement(sp, f"{{{A_NS}}}prstGeom", prst="rect")
    etree.SubElement(pg, f"{{{A_NS}}}avLst")
    return run


def make_image_paragraph(rid: str, cx: int, cy: int, doc_pr_id: int) -> etree._Element:
    p = etree.Element(w("p"))
    ppr = etree.SubElement(p, w("pPr"))
    etree.SubElement(ppr, w("bidi"))
    set_w_attrs(etree.SubElement(ppr, w("jc")), {"val": "center"})
    p.append(make_image_run(rid, cx, cy, doc_pr_id))
    return p


def make_image_cell(rid: str, cx: int, cy: int, doc_pr_id: int) -> etree._Element:
    tc = etree.Element(w("tc"))
    tcpr = etree.SubElement(tc, w("tcPr"))
    set_w_attrs(etree.SubElement(tcpr, w("tcW")), {"w": "3000", "type": "dxa"})
    p = etree.SubElement(tc, w("p"))
    ppr = etree.SubElement(p, w("pPr"))
    etree.SubElement(ppr, w("bidi"))
    set_w_attrs(etree.SubElement(ppr, w("jc")), {"val": "center"})
    p.append(make_image_run(rid, cx, cy, doc_pr_id))
    return tc


def make_empty_cell() -> etree._Element:
    tc = etree.Element(w("tc"))
    tcpr = etree.SubElement(tc, w("tcPr"))
    set_w_attrs(etree.SubElement(tcpr, w("tcW")), {"w": "3000", "type": "dxa"})
    etree.SubElement(tc, w("p"))
    return tc


def build_asset_table(imgs: list[bytes], add_image) -> etree._Element:
    tbl = etree.Element(w("tbl"))
    tblpr = etree.SubElement(tbl, w("tblPr"))
    set_w_attrs(etree.SubElement(tblpr, w("tblW")), {"w": "5000", "type": "pct"})
    set_w_attrs(etree.SubElement(tblpr, w("tblCellSpacing")), {"w": str(ASSET_IMAGE_GAP_DXA), "type": "dxa"})
    grid = etree.SubElement(tbl, w("tblGrid"))
    for _ in range(3):
        set_w_attrs(etree.SubElement(grid, w("gridCol")), {"w": "3000"})
    for i in range(0, len(imgs), 3):
        chunk = imgs[i : i + 3]
        tr = etree.SubElement(tbl, w("tr"))
        cells = [make_image_cell(*add_image(img)) for img in chunk]
        while len(cells) < 3:
            cells.append(make_empty_cell())
        for c in cells:
            tr.append(c)
    return tbl


class ImageRegistry:
    def __init__(self, rels_xml: str, ct_xml: str, media_paths: set[str]):
        empty = b'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        self.rels_root = etree.fromstring(rels_xml.encode("utf-8") if rels_xml.strip() else empty)
        self.ct_xml = ct_xml
        self.media_paths = set(media_paths)
        self.new_media: dict[str, bytes] = {}
        self.doc_pr_id = 1000

    def reserve_existing_drawing_ids(self, root: etree._Element) -> None:
        ids: list[int] = []
        for el in root.iter():
            local = etree.QName(el).localname
            if local not in ("docPr", "cNvPr"):
                continue
            raw = el.get("id")
            if raw and raw.isdigit():
                ids.append(int(raw))
        self.doc_pr_id = max([self.doc_pr_id - 1, *ids]) + 1

    def add(self, img_bytes: bytes) -> tuple[str, int, int, int]:
        rid = next_rid(self.rels_root)
        media_path = next_image_path(self.media_paths)
        self.media_paths.add(media_path)
        jpeg = ensure_jpeg(img_bytes)
        self.new_media[media_path] = jpeg
        rel = etree.SubElement(self.rels_root, f"{{{REL_NS}}}Relationship")
        rel.set("Id", rid)
        rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
        rel.set("Target", media_path.replace("word/", ""))
        self.ct_xml = ensure_content_type(self.ct_xml, media_path)
        doc_id = self.doc_pr_id
        self.doc_pr_id += 2
        return rid, 1900000, 1420000, doc_id

    def add_valuation(self, img_bytes: bytes) -> tuple[str, int, int, int]:
        rid, _, _, doc_id = self.add(img_bytes)
        cx, cy = scaled_image_size_for_width_only(
            img_bytes,
            int(8.27 * EMU_PER_INCH * VALUATION_IMAGE_PAGE_WIDTH_RATIO),
        )
        return rid, cx, cy, doc_id


def apply_image_bookmarks(
    doc_xml: bytes,
    asset_images: list[bytes],
    valuation_images: list[bytes],
    registry: ImageRegistry,
) -> tuple[bytes, dict[str, int]]:
    root = etree.fromstring(doc_xml)
    registry.reserve_existing_drawing_ids(root)
    body = root.find(".//" + w("body"))
    stats = {"asset": 0, "valuation": 0}
    if body is None:
        return doc_xml, stats

    pairs = find_bookmark_pairs(root)
    images_by_field = {"asset": asset_images, "valuation": valuation_images}

    ops: list[tuple[etree._Element, etree._Element, etree._Element, dict[str, Any], list[bytes]]] = []

    for bm_key, cfg in IMAGE_BOOKMARKS.items():
        imgs = images_by_field.get(cfg["field"], [])
        if not imgs:
            continue

        target = None
        for name, _bid, s, e in pairs:
            if normalize_bookmark_name(name) == normalize_bookmark_name(bm_key):
                target = (s, e)
                break
        if not target:
            continue

        start, end = target
        para = find_ancestor(start, w("p"))
        if para is None:
            continue
        ops.append((para, start, end, cfg, imgs))

    for para, start, end, cfg, imgs in ops:
        replace_start_para = para
        replace_end_para = para

        if cfg.get("remove_placeholder"):
            children = list(body)
            try:
                idx = children.index(para)
                i = idx - 1
                while i >= 0 and children[i].tag == w("p") and paragraph_is_placeholder_image(children[i]):
                    replace_start_para = children[i]
                    i -= 1
            except ValueError:
                pass

        children = list(body)
        try:
            start_idx = children.index(replace_start_para)
            end_idx = children.index(replace_end_para)
        except ValueError:
            continue

        for i in range(end_idx, start_idx - 1, -1):
            body.remove(children[i])

        insert_idx = start_idx

        if cfg.get("layout") == "grid3":

            def add_img(img: bytes):
                rid, cx, cy, doc_id = registry.add(img)
                stats["asset"] += 1
                return rid, cx, cy, doc_id

            body.insert(insert_idx, build_asset_table(imgs, add_img))
        else:
            for offset, img in enumerate(imgs):
                rid, cx, cy, doc_id = registry.add_valuation(img)
                body.insert(insert_idx + offset, make_image_paragraph(rid, cx, cy, doc_id))
                stats["valuation"] += 1

    out = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
    return out, stats


def write_docx_zip(zin: zipfile.ZipFile, modified: dict[str, bytes]) -> bytes:
    out_buf = io.BytesIO()
    names = zin.namelist()
    ordered: list[str] = []
    if "mimetype" in names:
        ordered.append("mimetype")
    for name in names:
        if name != "mimetype":
            ordered.append(name)
    for path in modified:
        if path not in ordered:
            ordered.append(path)

    with zipfile.ZipFile(out_buf, "w") as zout:
        for fname in ordered:
            if fname in modified:
                data = modified[fname]
            elif fname in names:
                data = zin.read(fname)
            else:
                continue
            compress = zipfile.ZIP_STORED if fname == "mimetype" else zipfile.ZIP_DEFLATED
            zi = zipfile.ZipInfo(fname)
            zi.compress_type = compress
            zout.writestr(zi, data)
    return out_buf.getvalue()


def downscale_jpeg_bytes(img_bytes: bytes, max_dimension: int) -> bytes:
    """يحدّ أبعاد الصورة الأطول لأقصى قيمة قبل تضمينها في Word — صور كاميرا الهاتف الأصلية
    (غالباً 3000-4000px) لا تحتاج هذه الدقة لعرض بعرض صفحة تقرير؛ تقليصها يسرّع الدمج
    ويقلّص حجم ملف الـ docx الناتج كثيراً بلا أي فرق بصري ملحوظ عند الطباعة أو العرض."""
    try:
        img = Image.open(io.BytesIO(img_bytes))
        img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        width, height = img.size
        longest = max(width, height)
        if longest > max_dimension > 0:
            scale = max_dimension / longest
            img = img.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=90)
        return out.getvalue()
    except Exception:
        return img_bytes


def crop_to_fill_jpeg_bytes(
    img_bytes: bytes,
    target_width: int,
    target_height: int,
) -> bytes:
    img = Image.open(io.BytesIO(img_bytes))
    img = img.convert("RGB")
    width, height = img.size
    target_ratio = max(1, target_width) / max(1, target_height)
    source_ratio = width / max(1, height)
    if source_ratio > target_ratio:
        crop_width = max(1, int(height * target_ratio))
        left = max(0, (width - crop_width) // 2)
        cropped = img.crop((left, 0, left + crop_width, height))
    else:
        crop_height = max(1, int(width / target_ratio))
        top = max(0, (height - crop_height) // 2)
        cropped = img.crop((0, top, width, top + crop_height))
    longest = max(cropped.size)
    if longest > ASSET_IMAGE_MAX_SQUARE_PX:
        scale = ASSET_IMAGE_MAX_SQUARE_PX / longest
        cropped = cropped.resize(
            (max(1, int(cropped.width * scale)), max(1, int(cropped.height * scale))),
            Image.LANCZOS,
        )
    out = io.BytesIO()
    cropped.save(out, format="JPEG", quality=90)
    return out.getvalue()


def package_base_for_rels(rels_name: str) -> str:
    if rels_name == "_rels/.rels":
        return ""
    marker = "/_rels/"
    if marker not in rels_name:
        return ""
    prefix, rel_file = rels_name.split(marker, 1)
    source_part = f"{prefix}/{rel_file[:-5]}" if rel_file.endswith(".rels") else f"{prefix}/{rel_file}"
    return source_part.rsplit("/", 1)[0] if "/" in source_part else ""


def validate_docx_package(docx_bytes: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        bad = zf.testzip()
        if bad:
            raise ValueError(f"Corrupt zip member: {bad}")
        names = set(zf.namelist())
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise ValueError("Invalid docx package: required parts are missing")

        ct_root = etree.fromstring(zf.read("[Content_Types].xml"))
        ct_ns = "http://schemas.openxmlformats.org/package/2006/content-types"
        defaults: set[str] = set()
        overrides: set[str] = set()
        for child in ct_root:
            if child.tag == f"{{{ct_ns}}}Default":
                ext = (child.get("Extension") or "").lower()
                if ext in defaults:
                    raise ValueError(f"Duplicate content type default: {ext}")
                defaults.add(ext)
            elif child.tag == f"{{{ct_ns}}}Override":
                part = child.get("PartName") or ""
                if part in overrides:
                    raise ValueError(f"Duplicate content type override: {part}")
                overrides.add(part)

        for name in names:
            if name.endswith("/"):
                continue
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if f"/{name}" not in overrides and ext not in defaults:
                raise ValueError(f"Missing content type for {name}")
            if name.endswith(".xml") or name.endswith(".rels"):
                etree.fromstring(zf.read(name))

        rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
        for rels_name in [n for n in names if n.endswith(".rels")]:
            root = etree.fromstring(zf.read(rels_name))
            ids: set[str] = set()
            base = package_base_for_rels(rels_name)
            for rel in root:
                if rel.tag != f"{{{rel_ns}}}Relationship":
                    continue
                rid = rel.get("Id") or ""
                if rid in ids:
                    raise ValueError(f"Duplicate relationship id {rid} in {rels_name}")
                ids.add(rid)
                if (rel.get("TargetMode") or "").lower() == "external":
                    continue
                target = (rel.get("Target") or "").split("#", 1)[0]
                if not target:
                    continue
                part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
                if part not in names:
                    raise ValueError(f"Missing relationship target {part} from {rels_name}")

        for part_name in [n for n in names if MERGE_PARTS_RE.match(n)]:
            validate_part_xml(zf.read(part_name), part_name)


def normalize_docx_drawing_ids(docx_bytes: bytes) -> bytes:
    modified: dict[str, bytes] = {}
    next_id = 1
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zin:
        for name in zin.namelist():
            if not (name.startswith("word/") and name.endswith(".xml")):
                continue
            raw = zin.read(name)
            try:
                root = etree.fromstring(raw)
            except Exception:
                continue
            changed = False
            for el in root.iter():
                local = etree.QName(el).localname
                if local not in ("docPr", "cNvPr") or el.get("id") is None:
                    continue
                el.set("id", str(next_id))
                next_id += 1
                changed = True
            if changed:
                modified[name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")
        if not modified:
            return docx_bytes
        return write_docx_zip(zin, modified)


def docx_qn(tag: str) -> str:
    from docx.oxml.ns import qn

    return qn(tag)


def make_docx_element(tag: str):
    from docx.oxml import OxmlElement

    return OxmlElement(tag)


def set_docx_cell_margins(cell, margin_dxa: int = 0) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    existing = tc_pr.find(docx_qn("w:tcMar"))
    if existing is not None:
        tc_pr.remove(existing)
    tc_mar = make_docx_element("w:tcMar")
    for side in ("top", "left", "bottom", "right"):
        node = make_docx_element(f"w:{side}")
        node.set(docx_qn("w:w"), str(margin_dxa))
        node.set(docx_qn("w:type"), "dxa")
        tc_mar.append(node)
    tc_pr.append(tc_mar)


def set_docx_table_borders_none(table) -> None:
    tbl_pr = table._tbl.tblPr
    tbl_borders = tbl_pr.find(docx_qn("w:tblBorders"))
    if tbl_borders is not None:
        tbl_pr.remove(tbl_borders)
    tbl_borders = make_docx_element("w:tblBorders")
    for border_name in ("top", "left", "bottom", "right", "insideH", "insideV"):
        border = make_docx_element(f"w:{border_name}")
        border.set(docx_qn("w:val"), "none")
        border.set(docx_qn("w:sz"), "0")
        border.set(docx_qn("w:space"), "0")
        border.set(docx_qn("w:color"), "auto")
        tbl_borders.append(border)
    tbl_pr.append(tbl_borders)


def set_docx_table_cell_spacing(table, spacing_dxa: int = 0) -> None:
    tbl_pr = table._tbl.tblPr
    existing = tbl_pr.find(docx_qn("w:tblCellSpacing"))
    if existing is not None:
        tbl_pr.remove(existing)
    spacing = make_docx_element("w:tblCellSpacing")
    spacing.set(docx_qn("w:w"), str(max(0, int(spacing_dxa))))
    spacing.set(docx_qn("w:type"), "dxa")
    tbl_pr.append(spacing)


def set_docx_table_width(table, width_emu: int) -> None:
    width_dxa = max(1, int(width_emu / EMU_PER_INCH * 1440))
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(docx_qn("w:tblW"))
    if tbl_w is not None:
        tbl_pr.remove(tbl_w)
    tbl_w = make_docx_element("w:tblW")
    tbl_w.set(docx_qn("w:w"), str(width_dxa))
    tbl_w.set(docx_qn("w:type"), "dxa")
    tbl_pr.append(tbl_w)
    layout = make_docx_element("w:tblLayout")
    layout.set(docx_qn("w:type"), "fixed")
    tbl_pr.append(layout)


def set_docx_table_indent(table, indent_emu: int) -> None:
    tbl_pr = table._tbl.tblPr
    existing = tbl_pr.find(docx_qn("w:tblInd"))
    if existing is not None:
        tbl_pr.remove(existing)
    indent = make_docx_element("w:tblInd")
    indent.set(docx_qn("w:w"), str(emu_to_twips(indent_emu)))
    indent.set(docx_qn("w:type"), "dxa")
    tbl_pr.append(indent)


def detach_docx_body_element(elem) -> Any:
    parent = elem.getparent()
    if parent is not None:
        parent.remove(elem)
    return elem


def make_docx_title_element(doc, title: str):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(6)
    p.add_run(title)
    return detach_docx_body_element(p._element)


def make_docx_page_break_element(doc):
    from docx.enum.text import WD_BREAK

    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)
    return detach_docx_body_element(p._element)


def document_page_inner_box_emu(doc) -> tuple[int, int]:
    section = doc.sections[0]
    page_width = int(section.page_width or int(8.27 * EMU_PER_INCH))
    page_height = int(section.page_height or int(11.69 * EMU_PER_INCH))
    left_margin = int(section.left_margin or int(0.5 * EMU_PER_INCH))
    right_margin = int(section.right_margin or int(0.5 * EMU_PER_INCH))
    top_margin = int(section.top_margin or int(0.5 * EMU_PER_INCH))
    bottom_margin = int(section.bottom_margin or int(0.5 * EMU_PER_INCH))
    content_width = int(page_width - left_margin - right_margin)
    content_height = int(page_height - top_margin - bottom_margin)
    if content_width <= 0:
        content_width = int(7.28 * EMU_PER_INCH)
    if content_height <= 0:
        content_height = int(10.0 * EMU_PER_INCH)
    return content_width, content_height


def document_physical_page_box_emu(doc) -> tuple[int, int]:
    section = doc.sections[0]
    page_width = int(section.page_width or int(8.27 * EMU_PER_INCH))
    page_height = int(section.page_height or int(11.69 * EMU_PER_INCH))
    if page_width <= 0:
        page_width = int(8.27 * EMU_PER_INCH)
    if page_height <= 0:
        page_height = int(11.69 * EMU_PER_INCH)
    return page_width, page_height


def document_section_margins_emu(doc) -> tuple[int, int, int, int]:
    section = doc.sections[0]
    left_margin = int(section.left_margin or int(0.5 * EMU_PER_INCH))
    right_margin = int(section.right_margin or int(0.5 * EMU_PER_INCH))
    top_margin = int(section.top_margin or int(0.5 * EMU_PER_INCH))
    bottom_margin = int(section.bottom_margin or int(0.5 * EMU_PER_INCH))
    return left_margin, right_margin, top_margin, bottom_margin


def w_attr_int(el, name: str, fallback: int) -> int:
    if el is None:
        return fallback
    raw = el.get(docx_qn(f"w:{name}"))
    try:
        return int(raw) if raw is not None else fallback
    except (TypeError, ValueError):
        return fallback


def twips_to_emu(value: int) -> int:
    return int(value * EMU_PER_INCH / 1440)


def emu_to_twips(value: int | float) -> int:
    return int(round(float(value) * 1440 / EMU_PER_INCH))


def section_metrics_from_sect_pr(sect_pr) -> tuple[int, int, int, int, int, int] | None:
    if sect_pr is None:
        return None

    pg_sz = sect_pr.find(docx_qn("w:pgSz"))
    pg_mar = sect_pr.find(docx_qn("w:pgMar"))
    page_width_twips = w_attr_int(pg_sz, "w", 0)
    page_height_twips = w_attr_int(pg_sz, "h", 0)

    page_width = twips_to_emu(page_width_twips) if page_width_twips > 0 else DEFAULT_PAGE_WIDTH_EMU
    page_height = twips_to_emu(page_height_twips) if page_height_twips > 0 else DEFAULT_PAGE_HEIGHT_EMU
    left_margin = twips_to_emu(w_attr_int(pg_mar, "left", emu_to_twips(DEFAULT_PAGE_MARGIN_EMU)))
    right_margin = twips_to_emu(w_attr_int(pg_mar, "right", emu_to_twips(DEFAULT_PAGE_MARGIN_EMU)))
    top_margin = twips_to_emu(w_attr_int(pg_mar, "top", emu_to_twips(DEFAULT_PAGE_MARGIN_EMU)))
    bottom_margin = twips_to_emu(w_attr_int(pg_mar, "bottom", emu_to_twips(DEFAULT_PAGE_MARGIN_EMU)))
    return page_width, page_height, left_margin, right_margin, top_margin, bottom_margin


def first_section_metrics_at_or_after(children: list[Any], start_idx: int):
    for child in children[max(0, start_idx) :]:
        sect_pr = child if getattr(child, "tag", None) == docx_qn("w:sectPr") else child.find(f".//{docx_qn('w:sectPr')}")
        metrics = section_metrics_from_sect_pr(sect_pr)
        if metrics is not None:
            return metrics
    return None


def document_valuation_image_layout_emu(
    doc,
    section_metrics: tuple[int, int, int, int, int, int] | None = None,
) -> tuple[int, int, int]:
    """Use 95% of the physical page width with equal physical side margins."""
    if section_metrics is None:
        page_width, _ = document_physical_page_box_emu(doc)
        left_margin, right_margin, _top_margin, _bottom_margin = document_section_margins_emu(doc)
    else:
        page_width, _page_height, left_margin, right_margin, _top_margin, _bottom_margin = section_metrics
    page_width = max(1, page_width)
    target_width = max(1, int(page_width * IMAGE_CONTENT_WIDTH_RATIO))
    physical_side_margin = max(0, (page_width - target_width) // 2)
    return (
        target_width,
        physical_side_margin - left_margin,
        physical_side_margin - right_margin,
    )


def configure_rtl_valuation_image_paragraph(paragraph, indent_left: int, indent_right: int) -> None:
    p_pr = paragraph._element.get_or_add_pPr()
    for tag in ("w:jc", "w:bidi", "w:ind"):
        el = p_pr.find(docx_qn(tag))
        if el is not None:
            p_pr.remove(el)

    p_pr.append(make_docx_element("w:bidi"))
    jc = make_docx_element("w:jc")
    jc.set(docx_qn("w:val"), "right")
    p_pr.append(jc)

    ind = make_docx_element("w:ind")
    left_twips = emu_to_twips(indent_left)
    right_twips = emu_to_twips(indent_right)
    ind.set(docx_qn("w:left"), str(left_twips))
    ind.set(docx_qn("w:right"), str(right_twips))
    ind.set(docx_qn("w:start"), str(right_twips))
    ind.set(docx_qn("w:end"), str(left_twips))
    p_pr.append(ind)


def scaled_image_size_for_width_only(img_bytes: bytes, target_width_emu: int) -> tuple[int, int]:
    with Image.open(io.BytesIO(img_bytes)) as img:
        width_px, height_px = img.size
    if width_px <= 0 or height_px <= 0:
        raise ValueError("invalid image dimensions")
    cx = max(1, int(target_width_emu))
    cy = max(1, int(cx * height_px / width_px))
    return cx, cy


def document_content_box_emu(doc) -> tuple[int, int]:
    content_width, content_height = document_page_inner_box_emu(doc)
    content_height = int(content_height - int(0.65 * EMU_PER_INCH))
    if content_height <= 0:
        content_height = int(9.0 * EMU_PER_INCH)
    return content_width, content_height


def document_cell_dimensions_emu(
    doc,
    images_per_row: int,
    image_rows_per_page: int,
    section_metrics: tuple[int, int, int, int, int, int] | None = None,
) -> tuple[int, int]:
    _content_width, content_height = document_content_box_emu(doc)
    if section_metrics is None:
        page_width, _page_height = document_physical_page_box_emu(doc)
    else:
        page_width = section_metrics[0]
    available_width = max(1, int(page_width * IMAGE_CONTENT_WIDTH_RATIO))
    width_fit = max(1, (available_width - (images_per_row - 1) * ASSET_IMAGE_GAP_EMU) // images_per_row)
    height_fit = max(1, (content_height - (image_rows_per_page - 1) * ASSET_IMAGE_GAP_EMU) // image_rows_per_page)
    return width_fit, max(1, min(width_fit, height_fit))


def scaled_image_size_for_width(img_bytes: bytes, target_width_emu: int, max_height_emu: int) -> tuple[int, int]:
    with Image.open(io.BytesIO(img_bytes)) as img:
        width_px, height_px = img.size
    if width_px <= 0 or height_px <= 0:
        raise ValueError("invalid image dimensions")
    cx = max(1, int(target_width_emu))
    cy = max(1, int(cx * height_px / width_px))
    if cy > max_height_emu > 0:
        scale = max_height_emu / cy
        cx = max(1, int(cx * scale))
        cy = max(1, int(cy * scale))
    return cx, cy


def make_docx_image_table_element(
    doc,
    images: list[bytes],
    images_per_row: int,
    image_rows_per_page: int,
    section_metrics: tuple[int, int, int, int, int, int] | None = None,
) -> tuple[Any, int]:
    from docx.enum.table import WD_ROW_HEIGHT_RULE, WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Emu, Pt

    rows = max(1, math.ceil(len(images) / images_per_row))
    cell_width_emu, image_emu = document_cell_dimensions_emu(
        doc,
        images_per_row,
        image_rows_per_page,
        section_metrics,
    )
    cell_width_dxa = max(1, int(cell_width_emu / EMU_PER_INCH * 1440))

    table = doc.add_table(rows=rows, cols=images_per_row)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    set_docx_table_borders_none(table)
    set_docx_table_cell_spacing(table, ASSET_IMAGE_GAP_DXA)
    set_docx_table_width(
        table,
        cell_width_emu * images_per_row + (images_per_row - 1) * ASSET_IMAGE_GAP_EMU,
    )
    if section_metrics is None:
        page_width, _page_height = document_physical_page_box_emu(doc)
        left_margin, _right_margin, _top_margin, _bottom_margin = document_section_margins_emu(doc)
    else:
        page_width, _page_height, left_margin, _right_margin, _top_margin, _bottom_margin = section_metrics
    physical_side_margin = max(0, int(page_width * (1 - IMAGE_CONTENT_WIDTH_RATIO) / 2))
    set_docx_table_indent(table, physical_side_margin - left_margin)

    inserted = 0
    img_index = 0
    for row in table.rows:
        row.height = Emu(image_emu)
        row.height_rule = WD_ROW_HEIGHT_RULE.EXACTLY
        for cell in row.cells:
            cell.width = Emu(cell_width_emu)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(docx_qn("w:tcW"))
            if tc_w is not None:
                tc_pr.remove(tc_w)
            tc_w = make_docx_element("w:tcW")
            tc_w.set(docx_qn("w:w"), str(cell_width_dxa))
            tc_w.set(docx_qn("w:type"), "dxa")
            tc_pr.append(tc_w)
            set_docx_cell_margins(cell, 0)

            para = cell.paragraphs[0]
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.space_after = Pt(0)
            if img_index >= len(images):
                continue
            try:
                img_buf = io.BytesIO(
                    crop_to_fill_jpeg_bytes(
                        images[img_index],
                        cell_width_emu,
                        image_emu,
                    )
                )
                para.add_run().add_picture(
                    img_buf,
                    width=Emu(cell_width_emu),
                    height=Emu(image_emu),
                )
                inserted += 1
            except Exception as exc:
                log(f"Skipped image {img_index + 1}: {exc}")
            img_index += 1

    return detach_docx_body_element(table._tbl), inserted


def make_docx_valuation_image_element(
    doc,
    img_bytes: bytes,
    section_metrics: tuple[int, int, int, int, int, int] | None = None,
) -> tuple[Any, int]:
    from docx.shared import Emu, Pt

    img_bytes = downscale_jpeg_bytes(img_bytes, VALUATION_IMAGE_MAX_DIMENSION_PX)
    target_width, indent_left, indent_right = document_valuation_image_layout_emu(doc, section_metrics)
    cx, cy = scaled_image_size_for_width_only(img_bytes, target_width)

    p = doc.add_paragraph()
    configure_rtl_valuation_image_paragraph(p, indent_left, indent_right)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    try:
        p.add_run().add_picture(io.BytesIO(img_bytes), width=Emu(cx), height=Emu(cy))
    except Exception as exc:
        log(f"Skipped valuation image: {exc}")
        return detach_docx_body_element(p._element), 0
    return detach_docx_body_element(p._element), 1


def block_contains_bookmark(block, bookmark_name: str) -> bool:
    norm = normalize_bookmark_name(bookmark_name)
    for bm in block.iter(docx_qn("w:bookmarkStart")):
        if normalize_bookmark_name(bm.get(docx_qn("w:name")) or "") == norm:
            return True
    return False


def block_is_placeholder_image(block) -> bool:
    if etree.QName(block).localname != "p":
        return False
    has_image = any(True for _ in block.iter(docx_qn("w:drawing"))) or any(True for _ in block.iter(docx_qn("w:pict")))
    if not has_image:
        return False
    text = "".join(node.text or "" for node in block.iter(docx_qn("w:t")))
    return not text.strip()


def replace_image_bookmark_with_docx_elements(
    doc,
    bookmark_name: str,
    images: list[bytes],
    remove_placeholder: bool,
    layout: str = "asset_grid",
    images_per_row: int = IMAGES_PER_ROW,
    images_per_page: int = IMAGES_PER_PAGE,
) -> int:
    body = doc.element.body
    children = list(body)
    target_idx = None
    for idx, child in enumerate(children):
        if block_contains_bookmark(child, bookmark_name):
            target_idx = idx
            break
    if target_idx is None or not images:
        return 0

    start_idx = target_idx
    if remove_placeholder:
        while start_idx > 0 and block_is_placeholder_image(children[start_idx - 1]):
            start_idx -= 1

    for idx in range(target_idx, start_idx - 1, -1):
        body.remove(children[idx])

    elements: list[Any] = []
    inserted = 0
    section_metrics = first_section_metrics_at_or_after(children, target_idx)
    if layout == "valuation_pages":
        for image_idx, image in enumerate(images):
            if image_idx > 0:
                elements.append(make_docx_page_break_element(doc))
            image_elem, count = make_docx_valuation_image_element(doc, image, section_metrics)
            elements.append(image_elem)
            inserted += count
    else:
        image_rows_per_page = max(1, math.ceil(images_per_page / images_per_row))
        for page_idx in range(0, len(images), images_per_page):
            if page_idx > 0:
                elements.append(make_docx_page_break_element(doc))
            table_elem, count = make_docx_image_table_element(
                doc,
                images[page_idx : page_idx + images_per_page],
                images_per_row,
                image_rows_per_page,
                section_metrics,
            )
            elements.append(table_elem)
            inserted += count

    for offset, elem in enumerate(elements):
        body.insert(start_idx + offset, elem)
    return inserted


def apply_image_bookmarks_docx_api(
    docx_bytes: bytes,
    asset_images: list[bytes],
    valuation_images: list[bytes],
    images_per_row: int = IMAGES_PER_ROW,
    images_per_page: int = IMAGES_PER_PAGE,
) -> tuple[bytes, dict[str, int]]:
    from docx import Document

    doc = Document(io.BytesIO(docx_bytes))
    stats = {"asset": 0, "valuation": 0}
    stats["asset"] = replace_image_bookmark_with_docx_elements(
        doc,
        "صوراصول",
        asset_images,
        True,
        "asset_grid",
        images_per_row,
        images_per_page,
    )
    stats["valuation"] = replace_image_bookmark_with_docx_elements(
        doc,
        "صورحسابات",
        valuation_images,
        True,
        "valuation_pages",
    )
    out = io.BytesIO()
    doc.save(out)
    result = normalize_docx_drawing_ids(out.getvalue())
    validate_docx_package(result)
    return result, stats


def merge_package(payload: dict[str, Any]) -> bytes:
    template_b64 = payload.get("templateBase64") or ""
    if not template_b64:
        raise ValueError("templateBase64 missing")

    template_bytes = base64.b64decode(template_b64)
    text_values = payload.get("textValues") or {}
    name_to_text = build_name_to_text(text_values, payload.get("textByBookmarkName") or {})
    asset_images = [base64.b64decode(x) for x in (payload.get("assetImagesBase64") or [])]
    valuation_images = [base64.b64decode(x) for x in (payload.get("valuationImagesBase64") or [])]
    image_layout = payload.get("imageLayout") if isinstance(payload.get("imageLayout"), dict) else {}
    try:
        images_per_row = max(1, min(6, int(image_layout.get("imagesPerRow", IMAGES_PER_ROW))))
    except (TypeError, ValueError):
        images_per_row = IMAGES_PER_ROW
    images_per_page = images_per_row * (5 if images_per_row >= 4 else 4)

    in_buf = io.BytesIO(template_bytes)
    modified: dict[str, bytes] = {}
    total_text = 0
    all_bookmarks: list[str] = []
    img_stats = {"asset": 0, "valuation": 0}

    with zipfile.ZipFile(in_buf, "r") as zin:
        names = zin.namelist()

        for fname in names:
            if MERGE_PARTS_RE.match(fname):
                raw = zin.read(fname)
                for bm in collect_bookmark_names(raw):
                    if bm not in all_bookmarks:
                        all_bookmarks.append(bm)
                updated, n = apply_text_bookmarks(raw, name_to_text, text_values)
                validate_part_xml(updated, fname)
                modified[fname] = updated
                total_text += n

        result = write_docx_zip(zin, modified)

    if asset_images or valuation_images:
        result, img_stats = apply_image_bookmarks_docx_api(
            result,
            asset_images,
            valuation_images,
            images_per_row,
            images_per_page,
        )
    else:
        validate_docx_package(result)

    log(
        json.dumps(
            {
                "textFilled": total_text,
                "assetImagesInserted": img_stats.get("asset", 0),
                "valuationImagesInserted": img_stats.get("valuation", 0),
                "bookmarksFound": all_bookmarks,
            },
            ensure_ascii=False,
        )
    )
    return result


def main() -> None:
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], encoding="utf-8") as fh:
                payload = json.load(fh)
        else:
            payload = json.load(sys.stdin)
        sys.stdout.buffer.write(merge_package(payload))
    except Exception:
        log(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
