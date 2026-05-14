#!/usr/bin/env python3
"""
WeasyPrint PDF generator for Real Estate Valuation Reports.
Usage:
    python generate_pdf.py < payload.json > report.pdf
Pages are rendered one-by-one as HTML and assembled into a single HTML
document that WeasyPrint converts to PDF in one pass.
Adding a new page:
    1. Create  pages/pageN_xxxx.py  with a  render(data) -> str  function.
    2. Import and call it in  _collect_pages()  below.
"""

import io
import json
import os
import sys
import traceback

# ── Page renderers ─────────────────────────────────────────────────────────────
from pages.page1_cover import render as page1_cover
from pages.page2_statement import render as page2_statement
from pages.page3_scope import render as page3_scope
from pages.page4_restrictions import render as page4_statement
from pages.page5_hierarchy import render as page5_hierarchy
from pages.page6_research import render as page6_research
from pages.page7_placeholder import render as page7_placeholder
from pages.page8_placeholder import render as page8_placeholder
from pages.page9_property_details import render as page9_property_details
from pages.page10_finishing_utilities import render as page10_finishing_utilities
from pages.page11_placeholder import render as page11_placeholder
from pages.page12_methodology import render as page12_methodology
from weasyprint import CSS, HTML

# ── Stylesheet path ────────────────────────────────────────────────────────────
_DIR = os.path.dirname(os.path.abspath(__file__))
_CSS_PATH = os.path.join(_DIR, "styles.css")


# ── Assemble page HTML fragments ───────────────────────────────────────────────
def _collect_pages(data: dict) -> str:
    parts = []
    parts.append(page1_cover(data))
    parts.append(page2_statement(data))
    parts.append(page3_scope(data))
    parts.append(page4_statement(data))
    parts.append(page5_hierarchy(data))
    parts.append(page6_research(data))
    parts.append(page7_placeholder(data))
    parts.append(page8_placeholder(data))
    parts.append(page9_property_details(data))
    parts.append(page10_finishing_utilities(data))
    parts.append(page11_placeholder(data))
    parts.append(page12_methodology(data))
    return "\n".join(parts)


# ── Build full HTML document ───────────────────────────────────────────────────
def build_html(data: dict) -> str:
    pages_html = _collect_pages(data)
    return f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>تقرير التقييم العقاري</title>
</head>
<body>
{pages_html}
</body>
</html>"""


# ── Render to PDF bytes ────────────────────────────────────────────────────────
def build_pdf(data: dict) -> bytes:
    html_content = build_html(data)
    html_obj = HTML(string=html_content, base_url=_DIR)
    # Use filename= instead of string= so WeasyPrint can resolve
    # @import "styles/components.css" relative to styles.css's directory
    css_obj = CSS(filename=_CSS_PATH)
    buf = io.BytesIO()
    html_obj.write_pdf(buf, stylesheets=[css_obj])
    return buf.getvalue()


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read()
        data = json.loads(raw.decode("utf-8"))
        pdf_bytes = build_pdf(data)
        sys.stdout.buffer.write(pdf_bytes)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
