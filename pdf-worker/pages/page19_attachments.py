from __future__ import annotations

"""
page19_attachments.py
=====================
Renders attachment pages after the property-image gallery (page 18+).

Rules
-----
• Image attachments  → one full page per image, header = attachment name.
• PDF attachments    → one full page per PDF *page*, header = PDF name.
  PDF pages are rasterized to PNG via pdf2image / Poppler so WeasyPrint
  can embed them without any native PDF-in-PDF tricks.

Each page reuses the same branded header / footer shell as every other
page in the report.
"""

import base64
import io
import math
from typing import List

# pdf2image is available wherever Poppler is installed (same venv as WeasyPrint).
# If it's missing the module fails gracefully — PDF pages are simply skipped
# and a warning placeholder is emitted instead.
try:
    from pdf2image import convert_from_path  # type: ignore

    _PDF2IMAGE_OK = True
except ImportError:
    _PDF2IMAGE_OK = False

# ── Layout constants ───────────────────────────────────────────────────────────

# A4 printable width with 16mm margins each side = 178mm.
# Usable height: 297mm − header(14mm) − section bar(8mm) − footer(12mm)
# − top/bottom padding(18mm×2) − section margin(4mm) = ~223mm → use 215mm.
_IMG_W = "178mm"  # fill full printable width
_IMG_MAX_H = "215mm"  # cap height so it never bleeds into footer


# ── Page shell ─────────────────────────────────────────────────────────────────


def _page(content_html: str, title: str, page_number: int) -> str:
    """Wrap *content_html* in the standard branded page shell."""
    safe_title = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"""
<div class="page statement-page">
    <div class="statement-watermark">تقدير</div>

    <div class="c-page-header">
        <div class="c-page-header__logo">
            <div class="c-page-header__mark"></div>
            <div class="c-page-header__text">
                <div class="c-page-header__ar">تقدير</div>
                <div class="c-page-header__en">Taqdeer</div>
            </div>
        </div>
    </div>

    <div style="margin-bottom:4mm;position:relative;z-index:2;">
        <div class="c-section-heading" style="direction:rtl;text-align:right;">
            {safe_title}
        </div>
    </div>

    <div style="position:relative;z-index:2;">
        <table style="width:100%;border-collapse:collapse;">
            <tr>
                <td style="text-align:center;vertical-align:middle;padding:0;">
                    {content_html}
                </td>
            </tr>
        </table>
    </div>

    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">{page_number}</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>
</div>
"""


def _img_tag(data_uri: str) -> str:
    # width:100% fills the full printable column; max-width caps it at the
    # physical page width in mm; max-height prevents bleeding into the footer;
    # height:auto keeps the aspect ratio intact.
    return (
        f'<img src="{data_uri}" alt="" '
        f'style="width:100%;max-width:{_IMG_W};max-height:{_IMG_MAX_H};'
        f'height:auto;display:block;"/>'
    )


def _missing_page(reason: str, page_number: int, title: str) -> str:
    content = (
        f'<div style="text-align:center;color:#999;font-size:10pt;padding:20mm;">'
        f"{reason}</div>"
    )
    return _page(content, title, page_number)


# ── PDF rasteriser ─────────────────────────────────────────────────────────────


def _pdf_to_data_uris(file_path: str) -> List[str]:
    """
    Convert every page of a PDF file to a base64 PNG data URI.
    Returns an empty list if pdf2image / Poppler is unavailable or the file
    cannot be read.
    """
    if not _PDF2IMAGE_OK:
        return []
    try:
        pil_images = convert_from_path(file_path, dpi=150, fmt="png")
        uris: List[str] = []
        for img in pil_images:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            uris.append(f"data:image/png;base64,{b64}")
        return uris
    except Exception:
        return []


# ── Public API ─────────────────────────────────────────────────────────────────


def render_all(data: dict, start_page: int = 19) -> List[str]:
    """
    Returns a list of page HTML strings — one string per attachment page.
    Returns [] when there are no attachments to render.

    Expected keys in *data*:
        imageAttachments  list of {dataUri, name}
        pdfAttachments    list of {filePath, name, size, mimeType}
    """
    pages: List[str] = []
    page_number = start_page

    # ── 1. Image attachments ───────────────────────────────────────────────────
    for att in data.get("imageAttachments", []):
        data_uri: str = att.get("dataUri", "")
        name: str = att.get("name", "مرفق")
        if not data_uri:
            pages.append(_missing_page("الصورة غير متوفرة", page_number, name))
        else:
            pages.append(_page(_img_tag(data_uri), name, page_number))
        page_number += 1

    # ── 2. PDF attachments ─────────────────────────────────────────────────────
    for att in data.get("pdfAttachments", []):
        file_path: str = att.get("filePath", "")
        name: str = att.get("name", "مستند PDF")

        if not file_path:
            pages.append(_missing_page("مسار الملف غير متوفر", page_number, name))
            page_number += 1
            continue

        uris = _pdf_to_data_uris(file_path)

        if not uris:
            # pdf2image not available or file unreadable — emit a single placeholder
            reason = (
                "تعذّر تحويل الملف إلى صورة. تأكد من تثبيت Poppler وmكتبة pdf2image."
                if not _PDF2IMAGE_OK
                else "تعذّر قراءة ملف PDF."
            )
            pages.append(_missing_page(reason, page_number, name))
            page_number += 1
            continue

        total = len(uris)
        for i, uri in enumerate(uris):
            # Append page-of-total suffix when the PDF has more than one page
            label = name if total == 1 else f"{name}  ({i + 1} / {total})"
            pages.append(_page(_img_tag(uri), label, page_number))
            page_number += 1

    return pages


def render(data: dict, start_page: int = 19) -> str:
    """Convenience shim — all attachment pages as one concatenated string."""
    return "\n".join(render_all(data, start_page=start_page))
