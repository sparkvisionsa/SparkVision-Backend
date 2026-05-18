from __future__ import annotations

import math
from typing import List

_PER_PAGE = 6  # images per page
_COLS = 2
_ROWS = 3

# Cell dimensions tuned for full A4 printable width.
# A4 printable width with 10mm margins each side = 190mm
# 2 columns: each td = 190mm / 2 = 95mm (no inter-column gap needed with border-collapse)
_TD_W = "95mm"
_TD_H = "80mm"  # taller cells now that there's no caption row
_IMG_MAX_W = "93mm"  # td_w minus 1mm breathing room each side
_IMG_MAX_H = "78mm"  # td_h minus 2mm top/bottom padding


# ─── cell builders ────────────────────────────────────────────────────────────


def _img_cell(data_uri: str, caption: str) -> str:
    return (
        f'<td style="width:{_TD_W};height:{_TD_H};padding:1mm;'
        f"border:1px solid var(--border-light, #d0e4e6);"
        f"background:var(--bg-table-cell, #f8f9fa);"
        f'vertical-align:middle;text-align:center;">'
        f'<img src="{data_uri}" alt="" '
        f'style="max-width:{_IMG_MAX_W};max-height:{_IMG_MAX_H};'
        f'width:auto;height:auto;display:inline;object-fit:contain;"/>'
        f"</td>"
    )


def _empty_cell() -> str:
    return (
        f'<td style="width:{_TD_W};height:{_TD_H};'
        f"border:1px dashed var(--border-light, #d0e4e6);"
        f'background:transparent;opacity:0.3;"></td>'
    )


# ─── page builder ─────────────────────────────────────────────────────────────


def _render_page(
    chunk: list,
    page_number: int,
    chunk_index: int,
    total_chunks: int,
) -> str:
    # Build exactly _PER_PAGE cell strings
    cells: List[str] = []
    for i in range(_PER_PAGE):
        if i < len(chunk):
            item = chunk[i]
            cells.append(_img_cell(item["dataUri"], item.get("name", "")))
        else:
            cells.append(_empty_cell())

    # Build table rows — direction:rtl on the table makes col 0 appear on the right
    rows_html = ""
    for row in range(_ROWS):
        a = cells[row * _COLS]
        b = cells[row * _COLS + 1]
        rows_html += f"<tr>{a}{b}</tr>\n"

    sub_label = ""
    if total_chunks > 1:
        sub_label = (
            f'<span style="font-size:8pt;color:var(--text-muted,#6c8a8e);margin-right:4mm;">'
            f"({chunk_index + 1} / {total_chunks})</span>"
        )

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

    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading" style="display:flex;align-items:center;direction:rtl;">
            صور العقار {sub_label}
        </div>
    </div>

    <div style="position:relative;z-index:2;">
        <table style="border-collapse:collapse;width:100%;table-layout:fixed;direction:rtl;">
            {rows_html}
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


# ─── public API ───────────────────────────────────────────────────────────────


def render_all(data: dict, start_page: int = 18) -> List[str]:
    """
    Return a list of page HTML strings — one string per 6 images.
    Returns [] when there are no images (no page is emitted).
    """
    images: list = data.get("images", [])
    if not images:
        return []

    total_chunks = math.ceil(len(images) / _PER_PAGE)
    pages: List[str] = []
    for idx in range(total_chunks):
        chunk = images[idx * _PER_PAGE : (idx + 1) * _PER_PAGE]
        pages.append(
            _render_page(
                chunk=chunk,
                page_number=start_page + idx,
                chunk_index=idx,
                total_chunks=total_chunks,
            )
        )
    return pages


def render(data: dict) -> str:
    """Convenience shim — all image pages as one concatenated string."""
    return "\n".join(render_all(data))
