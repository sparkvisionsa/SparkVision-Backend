#!/usr/bin/env python3
"""
Real-estate valuation PDF generator.
Reads a JSON payload from stdin, writes a PDF to stdout.
Merges any PDF attachments at the end using pypdf.

Usage:
    python generate_pdf.py < payload.json > report.pdf

Dependencies (install once in your venv):
    pip install reportlab pypdf Pillow arabic-reshaper python-bidi
"""

import base64
import io
import json
import os
import sys
import traceback

import arabic_reshaper
from bidi.algorithm import get_display
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# ── reportlab imports ──────────────────────────────────────────────────────────
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


# ── Arabic text shaping helper ────────────────────────────────────────────────
def reshape_arabic(text):
    """
    Reshape Arabic text and handle RTL for proper display.
    Returns text ready for ReportLab.
    """
    if not text or not isinstance(text, str):
        return text

    # Reshape Arabic letters to connect properly
    reshaped = arabic_reshaper.reshape(text)
    # Apply bidirectional algorithm for RTL
    bidi_text = get_display(reshaped)
    return bidi_text


# ── Page dimensions ────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = A4  # 595.27 x 841.89 pts
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

# ── Colors ─────────────────────────────────────────────────────────────────────
C_PRIMARY = colors.HexColor("#1a6fc4")
C_SECTION_HDR = colors.HexColor("#1e3a5f")
C_SURFACE_ALT = colors.HexColor("#f8fafc")
C_BORDER = colors.HexColor("#e2e8f0")
C_TEXT = colors.HexColor("#1e293b")
C_MUTED = colors.HexColor("#64748b")
C_GREEN = colors.HexColor("#16a34a")
C_AMBER = colors.HexColor("#d97706")
C_RED = colors.HexColor("#dc2626")
C_S1_TOTAL = colors.HexColor("#e0edff")
C_S1_PRICE = colors.HexColor("#cfe3ff")
C_S2_TOTAL = colors.HexColor("#dcfce7")
C_FINAL_PRICE = colors.HexColor("#bbf7d0")
C_WEIGHTS = colors.HexColor("#fef9c3")
C_CONTRIB = colors.HexColor("#fde68a")
C_BASE_PRICE = colors.HexColor("#dbeafe")
C_WHITE = colors.white

# ── Font registration ──────────────────────────────────────────────────────────
FONT_NORMAL = "Arabic"
FONT_BOLD = "ArabicBold"


def register_fonts(font_dir: str):
    normal = os.path.join(font_dir, "NotoNaskhArabic-Regular.ttf")
    bold = os.path.join(font_dir, "NotoNaskhArabic-Bold.ttf")
    if os.path.exists(normal) and os.path.exists(bold):
        pdfmetrics.registerFont(TTFont(FONT_NORMAL, normal))
        pdfmetrics.registerFont(TTFont(FONT_BOLD, bold))
        return True
    return False


# ── Paragraph styles ───────────────────────────────────────────────────────────
def make_styles(rtl: bool = True):
    align = TA_RIGHT if rtl else TA_LEFT
    return {
        "label": ParagraphStyle(
            "label",
            fontName=FONT_NORMAL,
            fontSize=7,
            textColor=C_MUTED,
            alignment=align,
            leading=10,
        ),
        "value": ParagraphStyle(
            "value",
            fontName=FONT_BOLD,
            fontSize=9,
            textColor=C_TEXT,
            alignment=align,
            leading=12,
        ),
        "header_title": ParagraphStyle(
            "header_title",
            fontName=FONT_BOLD,
            fontSize=16,
            textColor=C_WHITE,
            alignment=align,
            leading=20,
        ),
        "header_sub": ParagraphStyle(
            "header_sub",
            fontName=FONT_NORMAL,
            fontSize=9,
            textColor=C_WHITE,
            alignment=align,
            leading=12,
        ),
        "section": ParagraphStyle(
            "section",
            fontName=FONT_BOLD,
            fontSize=11,
            textColor=C_WHITE,
            alignment=align,
            leading=14,
        ),
        "tbl_hdr": ParagraphStyle(
            "tbl_hdr",
            fontName=FONT_BOLD,
            fontSize=8,
            textColor=C_WHITE,
            alignment=TA_CENTER,
            leading=10,
        ),
        "tbl_cell": ParagraphStyle(
            "tbl_cell",
            fontName=FONT_NORMAL,
            fontSize=8,
            textColor=C_TEXT,
            alignment=TA_CENTER,
            leading=10,
        ),
        "tbl_cell_r": ParagraphStyle(
            "tbl_cell_r",
            fontName=FONT_NORMAL,
            fontSize=8,
            textColor=C_TEXT,
            alignment=TA_RIGHT,
            leading=10,
        ),
        "kpi_label": ParagraphStyle(
            "kpi_label",
            fontName=FONT_NORMAL,
            fontSize=8,
            textColor=C_MUTED,
            alignment=TA_RIGHT,
            leading=10,
        ),
        "kpi_value": ParagraphStyle(
            "kpi_value",
            fontName=FONT_BOLD,
            fontSize=12,
            textColor=C_PRIMARY,
            alignment=TA_RIGHT,
            leading=15,
        ),
        "att_name": ParagraphStyle(
            "att_name",
            fontName=FONT_BOLD,
            fontSize=10,
            textColor=C_TEXT,
            alignment=TA_RIGHT,
            leading=13,
        ),
        "img_caption": ParagraphStyle(
            "img_caption",
            fontName=FONT_NORMAL,
            fontSize=8,
            textColor=C_MUTED,
            alignment=TA_CENTER,
            leading=10,
        ),
        "final_label": ParagraphStyle(
            "final_label",
            fontName=FONT_NORMAL,
            fontSize=9,
            textColor=C_WHITE,
            alignment=TA_RIGHT,
            leading=12,
        ),
        "final_value": ParagraphStyle(
            "final_value",
            fontName=FONT_BOLD,
            fontSize=16,
            textColor=C_WHITE,
            alignment=TA_RIGHT,
            leading=20,
        ),
        "body": ParagraphStyle(
            "body",
            fontName=FONT_NORMAL,
            fontSize=9,
            textColor=C_TEXT,
            alignment=TA_RIGHT,
            leading=13,
        ),
    }


S = {}  # populated after font registration

# ── Helpers ────────────────────────────────────────────────────────────────────


def parse_num(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", ""))
    except:
        return 0.0


def fmt(n: float, decimals: int = 2) -> str:
    if not isinstance(n, (int, float)) or not (n == n):  # nan check
        return "—"
    return f"{n:,.{decimals}f}"


def dash(v) -> str:
    return str(v) if v else "—"


def lv(label: str, value: str) -> list:
    """Stack of label + value paragraphs for a labeled cell."""
    # Apply Arabic reshaping to labels and values
    reshaped_label = reshape_arabic(label) if label else label
    reshaped_value = reshape_arabic(dash(value)) if value else dash(value)
    return [
        Paragraph(reshaped_label, S["label"]),
        Paragraph(reshaped_value, S["value"]),
    ]


def tbl_style_base() -> list:
    return [
        ("GRID", (0, 0), (-1, -1), 0.5, C_BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), C_SURFACE_ALT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]


# ── Section header ─────────────────────────────────────────────────────────────


def section_header(title: str) -> Table:
    reshaped_title = reshape_arabic(title)
    t = Table([[Paragraph(reshaped_title, S["section"])]], colWidths=[CONTENT_W])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), C_PRIMARY),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


# ── Field rows ─────────────────────────────────────────────────────────────────


def three_col_row(items: list) -> Table:
    """items = [(label, value), (label, value), (label, value)]  right→left"""
    w = CONTENT_W / 3
    # RTL: rendered right-to-left so we reverse
    row = [lv(items[i][0], items[i][1]) for i in (2, 1, 0)]
    t = Table([row], colWidths=[w, w, w])
    t.setStyle(TableStyle(tbl_style_base()))
    return t


def two_col_row(r_label: str, r_val, l_label: str, l_val) -> Table:
    w = CONTENT_W / 2
    row = [lv(l_label, l_val), lv(r_label, r_val)]
    t = Table([row], colWidths=[w, w])
    t.setStyle(TableStyle(tbl_style_base()))
    return t


def full_row(label: str, value) -> Table:
    t = Table([[lv(label, value)]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle(tbl_style_base()))
    return t


def sp(h: float = 4) -> Spacer:
    return Spacer(1, h)


# ── Image helper ───────────────────────────────────────────────────────────────


def safe_image(data_uri: str, max_w: float, max_h: float):
    """
    Returns a reportlab Image flowable or None on failure.
    Never upscales — only downscales if the natural size exceeds max_w/max_h.
    """
    try:
        # Strip the data URI prefix
        if "," in data_uri:
            header, b64data = data_uri.split(",", 1)
        else:
            b64data = data_uri

        raw = base64.b64decode(b64data)
        buf = io.BytesIO(raw)

        # Use Pillow to get natural dimensions without decoding fully
        from PIL import Image as PILImage

        pil = PILImage.open(buf)
        nat_w, nat_h = pil.size  # pixels — we treat as points for sizing
        buf.seek(0)

        # Only downscale, never upscale
        scale = min(1.0, max_w / nat_w, max_h / nat_h)
        draw_w = nat_w * scale
        draw_h = nat_h * scale

        img = Image(buf, width=draw_w, height=draw_h)
        return img
    except Exception as e:
        print(f"[safe_image] Failed: {e}", file=sys.stderr)
        return None


# ── Footer callback ────────────────────────────────────────────────────────────


class FooterCanvas:
    """Mixin — we use SimpleDocTemplate's onLaterPages/onFirstPage hooks."""

    pass


def make_footer(assignment_number: str):
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(C_BORDER)
        canvas.setLineWidth(0.5)
        y = 15 * mm
        canvas.line(MARGIN, y + 6 * mm, PAGE_W - MARGIN, y + 6 * mm)

        canvas.setFont(FONT_NORMAL, 8)
        canvas.setFillColor(C_MUTED)
        # Left side (LTR position) — page number
        canvas.drawString(MARGIN, y + 2 * mm, f"صفحة {doc.page}")
        # Right side — title
        title = reshape_arabic(f"تقرير التقييم العقاري — {assignment_number}")
        canvas.drawRightString(PAGE_W - MARGIN, y + 2 * mm, title)
        canvas.restoreState()

    return footer


# ── Main builder ───────────────────────────────────────────────────────────────


def build_pdf(data: dict) -> bytes:
    global S

    # Font setup
    font_dir = data.get("fontDir", "assets/fonts")
    if not register_fonts(font_dir):
        # Try cwd-relative
        register_fonts(os.path.join(os.getcwd(), "assets/fonts"))
    S = make_styles()

    tx = data["tx"]
    ev = data["ev"]
    bl = data.get("bl", {})
    comp_rows = data.get("compRows", [])
    images = data.get("images", [])  # [{dataUri, name}]
    img_atts = data.get("imageAttachments", [])  # [{dataUri, name}]
    pdf_atts = data.get("pdfAttachments", [])  # [{filePath, name}]
    other_atts = data.get("otherAttachments", [])

    assignment = tx.get("assignmentNumber", "—")

    buf = io.BytesIO()
    footer_fn = make_footer(assignment)

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=15 * mm,
        bottomMargin=25 * mm,
        title=reshape_arabic(f"تقرير التقييم - {assignment}"),
        author=reshape_arabic("نظام التقييم العقاري"),
    )

    story = []

    # ── Header banner ──────────────────────────────────────────────────────────
    header_data = [
        [
            Paragraph(
                reshape_arabic(
                    f"رقم التكليف: {assignment}  |  التاريخ: {tx.get('assignmentDate', '—')}"
                ),
                S["header_sub"],
            ),
            Paragraph(reshape_arabic("تقرير التقييم العقاري"), S["header_title"]),
        ]
    ]
    header_tbl = Table(header_data, colWidths=[CONTENT_W * 0.4, CONTENT_W * 0.6])
    header_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), C_PRIMARY),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEABOVE", (0, 0), (-1, 0), 3, colors.HexColor("#f59e0b")),
            ]
        )
    )
    story += [header_tbl, sp(8)]

    # ── Label maps (passed through from Node) ──────────────────────────────────
    lmap = data.get("labelMaps", {})

    def lookup(mapping_name: str, key: str, fallback=None) -> str:
        m = lmap.get(mapping_name, {})
        value = m.get(str(key), fallback or str(key) if key else "—")
        return reshape_arabic(value) if value else value

    # ── 1. Request Information ─────────────────────────────────────────────────
    story += [section_header("معلومات الطلب"), sp()]
    story += [
        three_col_row(
            [
                ("الرقم المرجعي", tx.get("_id", "—")),
                ("رقم التكليف", assignment),
                ("تاريخ التكليف", tx.get("assignmentDate", "—")),
            ]
        ),
        sp(3),
    ]
    story += [
        three_col_row(
            [
                (
                    "الغرض من التقييم",
                    lookup("valuationPurposes", tx.get("valuationPurpose", "")),
                ),
                ("أساس القيمة", lookup("valuationBases", tx.get("valuationBasis", ""))),
                ("نوع الملكية", lookup("ownershipTypes", tx.get("ownershipType", ""))),
            ]
        ),
        sp(3),
    ]
    story += [
        three_col_row(
            [
                (
                    "فرضية التقييم",
                    lookup("valuationHypotheses", tx.get("valuationHypothesis", "")),
                ),
                ("العميل", tx.get("clientId", "—")),
                ("النموذج", tx.get("templateId", "—")),
            ]
        ),
        sp(3),
    ]
    if tx.get("intendedUse"):
        story += [full_row("الاستخدام المقصود", tx["intendedUse"]), sp(3)]

    # ── 2. Asset Information ───────────────────────────────────────────────────
    story += [section_header("معلومات الأصل"), sp()]
    story += [full_row("العنوان", bl.get("العنوان", "—")), sp(3)]
    story += [
        three_col_row(
            [
                ("نوع الأصل", bl.get("نوع الأصل", "—")),
                ("مساحة الأصل", bl.get("مساحة الأصل", ev.get("landSpace", "—"))),
                ("الاستخدام", bl.get("الاستخدام", "—")),
            ]
        ),
        sp(3),
    ]
    story += [
        three_col_row(
            [
                ("المعاين", bl.get("المعاين", "—")),
                ("رقم التواصل", bl.get("رقم التواصل", "—")),
                ("المراجع", bl.get("المراجع", "—")),
            ]
        ),
        sp(3),
    ]

    # ── 3. Location & Classification ──────────────────────────────────────────
    story += [section_header("الموقع وتصنيف الأصل"), sp()]
    story += [
        three_col_row(
            [
                ("المنطقة", lookup("regions", ev.get("regionId", ""))),
                ("المدينة", ev.get("cityName", "—")),
                ("الحي", ev.get("neighborhoodName", "—")),
            ]
        ),
        sp(3),
    ]
    asset_cat = {"1": "أراضي", "2": "مباني"}.get(
        str(ev.get("assetCategoryId", "")), "—"
    )
    story += [
        two_col_row(
            "نوع الأصل",
            lookup("propertyTypes", ev.get("propertyTypeId", "")),
            "تصنيف الأصل",
            asset_cat,
        ),
        sp(3),
    ]

    # ── 4. Basic Data ──────────────────────────────────────────────────────────
    story += [section_header("البيانات الأساسية"), sp()]
    story += [
        three_col_row(
            [
                ("رمز العقار", ev.get("propertyCode", "—")),
                ("اسم المالك", ev.get("ownerName", "—")),
                ("اسم العميل", ev.get("clientName", "—")),
            ]
        ),
        sp(3),
    ]
    story += [
        three_col_row(
            [
                ("اسم المفوض", ev.get("authorizedName", "—")),
                ("رقم الصك", ev.get("deedNumber", "—")),
                ("تاريخ الصك", ev.get("deedDate", "—")),
            ]
        ),
        sp(3),
    ]

    # ── 5. Boundaries ─────────────────────────────────────────────────────────
    story += [section_header("الحدود والأطوال"), sp()]
    for side, side_label in [
        ("north", "الشمالي"),
        ("south", "الجنوبي"),
        ("east", "الشرقي"),
        ("west", "الغربي"),
    ]:
        story += [
            two_col_row(
                f"الحد {side_label}",
                ev.get(f"{side}Boundary", "—"),
                f"طول الحد {side_label}",
                ev.get(f"{side}Length", "—"),
            ),
            sp(3),
        ]

    # ── 6. Finishing ──────────────────────────────────────────────────────────
    story += [section_header("بيانات التشطيب"), sp()]
    story += [
        three_col_row(
            [
                ("حالة المبنى", lookup("buildingStates", ev.get("buildingState", ""))),
                ("عدد الأدوار", ev.get("floorsCount", "—")),
                ("عمر العقار", ev.get("propertyAge", "—")),
            ]
        ),
        sp(3),
    ]
    story += [
        two_col_row(
            "مستوى التشطيب",
            lookup("finishLevels", ev.get("finishLevel", "")),
            "جودة البناء",
            lookup("buildQuality", ev.get("buildQuality", "")),
        ),
        sp(3),
    ]

    # ── 7. Comparison Table ───────────────────────────────────────────────────
    story.append(PageBreak())
    story += [section_header("جدول المقارنات"), sp()]

    if not comp_rows:
        story += [full_row("", "لا توجد مقارنات محددة"), sp(3)]
    else:

        def ch(text):
            return Paragraph(reshape_arabic(text), S["tbl_hdr"])

        def cd(text):
            return Paragraph(reshape_arabic(dash(text)), S["tbl_cell"])

        comp_header = [
            ch("المصدر"),
            ch("عرض الشارع"),
            ch("عدد الشوارع"),
            ch("الوصف"),
            ch("الإجمالي"),
            ch("سعر المتر"),
            ch("المساحة م2"),
            ch("نوع المقارنة"),
            ch("النوع"),
            ch("التاريخ"),
            ch("م"),
        ]
        comp_body = [comp_header]
        cw_unit = (CONTENT_W - 20 - 15) / 8
        comp_widths = [cw_unit * 1.2, 38, 35, cw_unit * 1.2, 45, 42, 42, 44, 48, 45, 15]

        for i, row in enumerate(comp_rows):
            bg = C_WHITE if i % 2 == 0 else C_SURFACE_ALT
            comp_body.append(
                [
                    cd(row.get("source")),
                    cd(row.get("street")),
                    cd(row.get("roads")),
                    cd(row.get("description")),
                    cd(row.get("total")),
                    cd(row.get("price")),
                    cd(row.get("landSpace")),
                    cd(row.get("comparisonKind")),
                    cd(lookup("propertyTypes", row.get("propertyTypeId", ""))),
                    cd(row.get("evalDate")),
                    cd(str(i + 1)),
                ]
            )

        comp_tbl = Table(comp_body, colWidths=comp_widths, repeatRows=1)
        st = tbl_style_base()
        st += [
            ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), C_WHITE),
        ]
        for i in range(1, len(comp_body)):
            bg = C_WHITE if (i - 1) % 2 == 0 else C_SURFACE_ALT
            st.append(("BACKGROUND", (0, i), (-1, i), bg))
        comp_tbl.setStyle(TableStyle(st))
        story += [comp_tbl, sp(8)]

    # ── 8. Settlement Table ───────────────────────────────────────────────────
    n = len(comp_rows)
    if n > 0:
        s1_rows = ev.get("section1Rows", [])
        s2_rows = [
            r for r in ev.get("settlementRows", []) if r.get("inReport") is not False
        ]
        bases = ev.get("settlementBases", [])
        weights = ev.get("settlementWeights", [])

        eff_bases = []
        for c in range(n):
            b = bases[c] if c < len(bases) and bases[c] not in (None, "") else ""
            eff_bases.append(
                b
                if b
                else (comp_rows[c].get("price", "") if c < len(comp_rows) else "")
            )

        s1_adj = []
        for c in range(n):
            base = parse_num(eff_bases[c])
            total = sum(
                base
                * parse_num(
                    (r.get("colAdj") or [])[c]
                    if c < len(r.get("colAdj", []) or [])
                    else 0
                )
                / 100
                for r in s1_rows
            )
            s1_adj.append(total)

        price_s1 = [parse_num(eff_bases[c]) + s1_adj[c] for c in range(n)]

        s2_adj = []
        for c in range(n):
            base = price_s1[c]
            total = sum(
                base
                * parse_num(
                    (r.get("colAdj") or [])[c]
                    if c < len(r.get("colAdj", []) or [])
                    else 0
                )
                / 100
                for r in s2_rows
            )
            s2_adj.append(total)

        price_all = [price_s1[c] + s2_adj[c] for c in range(n)]

        total_weight = sum(
            parse_num(weights[c]) if c < len(weights) else 0 for c in range(n)
        )
        weight_ok = abs(total_weight - 100) <= 0.01
        contributions = [
            price_all[c] * (parse_num(weights[c] if c < len(weights) else 0) / 100)
            for c in range(n)
        ]
        net_price = sum(contributions) if weight_ok else 0
        area = parse_num(ev.get("landSpace"))
        total_value = net_price * area

        s1_pct = [
            sum(
                parse_num(
                    (r.get("colAdj") or [])[c]
                    if c < len(r.get("colAdj", []) or [])
                    else 0
                )
                for r in s1_rows
            )
            for c in range(n)
        ]
        s2_pct = [
            sum(
                parse_num(
                    (r.get("colAdj") or [])[c]
                    if c < len(r.get("colAdj", []) or [])
                    else 0
                )
                for r in s2_rows
            )
            for c in range(n)
        ]

        col_w = max(50, int(240 / n))
        setl_widths = [105, 50] + [col_w] * n

        def sc(text, bold=False, color=C_TEXT, align=TA_CENTER, bg=None):
            st_name = "tbl_cell" if not bold else "tbl_hdr"
            p = ParagraphStyle(
                st_name + "_tmp",
                parent=S["tbl_cell"],
                textColor=color,
                alignment=align,
                fontName=FONT_BOLD if bold else FONT_NORMAL,
            )
            cell = Paragraph(reshape_arabic(dash(text)), p)
            return cell if bg is None else [cell]

        def setl_row(
            label, subj, comp_vals, bg=C_SURFACE_ALT, color=C_TEXT, bold=False
        ):
            lp = ParagraphStyle(
                "tmp_r",
                parent=S["tbl_cell_r"],
                textColor=color,
                fontName=FONT_BOLD if bold else FONT_NORMAL,
            )
            cp = ParagraphStyle(
                "tmp_c",
                parent=S["tbl_cell"],
                textColor=color,
                fontName=FONT_BOLD if bold else FONT_NORMAL,
            )
            return (
                [
                    Paragraph(reshape_arabic(label), lp),
                    Paragraph(reshape_arabic(dash(subj)), cp),
                ]
                + [Paragraph(reshape_arabic(dash(v)), cp) for v in comp_vals],
                bg,
            )

        story += [section_header("جدول التسويات والتعديلات"), sp()]

        setl_header = (
            [
                Paragraph(reshape_arabic("البند"), S["tbl_hdr"]),
                Paragraph(reshape_arabic("محل التقييم"), S["tbl_hdr"]),
            ]
            + [
                Paragraph(reshape_arabic(f"مقارنة {c + 1}"), S["tbl_hdr"])
                for c in range(n)
            ],
            C_PRIMARY,
        )

        rows_data = []  # list of (row_list, bg_color)
        rows_data.append(setl_header)
        rows_data.append(
            setl_row(
                "سعر المتر (ريال/م2)",
                "—",
                eff_bases,
                bg=C_BASE_PRICE,
                color=C_PRIMARY,
                bold=True,
            )
        )
        # Section 1 sub-header
        rows_data.append(
            (
                [
                    Paragraph(
                        reshape_arabic("القسم الاول: تعديلات ظروف السوق والتمويل"),
                        ParagraphStyle("sh", parent=S["tbl_hdr"], alignment=TA_RIGHT),
                    )
                ]
                + [Paragraph("", S["tbl_hdr"])] * (n + 1),
                C_SECTION_HDR,
            )
        )
        for r in s1_rows:
            adj = r.get("colAdj") or []
            rows_data.append(
                setl_row(
                    r.get("title", "—"),
                    r.get("valueM", "—"),
                    [(adj[c] if c < len(adj) else "—") for c in range(n)],
                )
            )
        rows_data.append(
            setl_row(
                "اجمالي تسويات القسم الاول (%)",
                "—",
                [fmt(v, 0) for v in s1_pct],
                bg=C_S1_TOTAL,
                color=C_PRIMARY,
                bold=True,
            )
        )
        rows_data.append(
            setl_row(
                "السعر بعد تسويات القسم الاول",
                "—",
                [fmt(v) for v in price_s1],
                bg=C_S1_PRICE,
                color=C_PRIMARY,
                bold=True,
            )
        )
        # Section 2 sub-header
        rows_data.append(
            (
                [
                    Paragraph(
                        reshape_arabic("القسم الثاني: تعديلات خصائص العقار"),
                        ParagraphStyle("sh2", parent=S["tbl_hdr"], alignment=TA_RIGHT),
                    )
                ]
                + [Paragraph("", S["tbl_hdr"])] * (n + 1),
                C_SECTION_HDR,
            )
        )
        for r in s2_rows:
            adj = r.get("colAdj") or []
            rows_data.append(
                setl_row(
                    r.get("title", "—"),
                    r.get("valueM", "—"),
                    [(adj[c] if c < len(adj) else "—") for c in range(n)],
                )
            )
        rows_data.append(
            setl_row(
                "اجمالي تسويات القسم الثاني (%)",
                "—",
                [fmt(v, 0) for v in s2_pct],
                bg=C_S2_TOTAL,
                color=C_GREEN,
                bold=True,
            )
        )
        rows_data.append(
            setl_row(
                "السعر النهائي بعد جميع التسويات",
                "—",
                [fmt(v) for v in price_all],
                bg=C_FINAL_PRICE,
                color=colors.HexColor("#065f46"),
                bold=True,
            )
        )
        rows_data.append(
            setl_row(
                "الوزن النسبي %",
                "—",
                [dash(weights[c] if c < len(weights) else "—") for c in range(n)],
                bg=C_WEIGHTS,
                color=C_AMBER,
                bold=True,
            )
        )
        rows_data.append(
            setl_row(
                "مساهمة المقارن (مرجح)",
                "—",
                [fmt(v) for v in contributions],
                bg=C_CONTRIB,
                color=C_AMBER,
                bold=True,
            )
        )

        table_rows = [r for r, _ in rows_data]
        table_bgs = [bg for _, bg in rows_data]

        setl_tbl = Table(table_rows, colWidths=setl_widths, repeatRows=1)
        st2 = [
            ("GRID", (0, 0), (-1, -1), 0.5, C_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TEXTCOLOR", (0, 0), (-1, 0), C_WHITE),
        ]
        for i, bg in enumerate(table_bgs):
            st2.append(("BACKGROUND", (0, i), (-1, i), bg))
        setl_tbl.setStyle(TableStyle(st2))
        story += [setl_tbl, sp(6)]

        # KPI row
        def kpi(label, value, color):
            return [
                Paragraph(reshape_arabic(label), S["kpi_label"]),
                Paragraph(
                    reshape_arabic(value),
                    ParagraphStyle("kpiv_tmp", parent=S["kpi_value"], textColor=color),
                ),
            ]

        w_status = f"{fmt(total_weight, 0)}% {'(صحيح)' if weight_ok else '(خطأ)'}"
        kpi_tbl = Table(
            [
                [
                    kpi(
                        "اجمالي قيمة العقار",
                        f"{fmt(total_value, 0)} ريال" if area and net_price else "—",
                        C_GREEN,
                    ),
                    kpi(
                        "اجمالي الوزن النسبي",
                        w_status if total_weight else "—",
                        C_GREEN if weight_ok else C_RED,
                    ),
                    kpi(
                        "صافي سعر المتر بعد جميع التسويات",
                        f"{fmt(net_price)} ريال/م2" if net_price else "—",
                        C_PRIMARY,
                    ),
                ]
            ],
            colWidths=[CONTENT_W / 3] * 3,
        )
        kpi_tbl.setStyle(
            TableStyle(
                [
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#c7d2fe")),
                    ("BACKGROUND", (0, 0), (-1, -1), C_SURFACE_ALT),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story += [kpi_tbl, sp(8)]

    # ── 9. Appraiser Opinion ──────────────────────────────────────────────────
    if ev.get("finalAssetValue") or ev.get("appraiserDesc") or ev.get("evalDate"):
        story += [section_header("رأي المقيم"), sp()]
        story += [
            three_col_row(
                [
                    ("تاريخ المعاينة", ev.get("evalDate", "—")),
                    ("تاريخ التقييم", ev.get("completedDate", "—")),
                    ("تاريخ التقرير", ev.get("reportDate", "—")),
                ]
            ),
            sp(3),
        ]
        val_str = f"{ev['finalAssetValue']} ريال" if ev.get("finalAssetValue") else "—"
        fin_tbl = Table(
            [
                [
                    Paragraph(
                        reshape_arabic("القيمة النهائية للأصل"), S["final_label"]
                    ),
                    Paragraph(reshape_arabic(val_str), S["final_value"]),
                ]
            ],
            colWidths=[CONTENT_W * 0.4, CONTENT_W * 0.6],
        )
        fin_tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), C_PRIMARY),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        story += [fin_tbl, sp(6)]
        if ev.get("appraiserDesc"):
            story += [
                full_row("وصف المقيم ورأيه حول الأصل", ev["appraiserDesc"]),
                sp(3),
            ]
        if ev.get("appraiserNotes"):
            story += [full_row("الملاحظات أو النواقص", ev["appraiserNotes"]), sp(3)]

    # ── 10. Report Items ──────────────────────────────────────────────────────
    report_fields = [
        ("معايير التقييم المتبعة", ev.get("standards")),
        ("نطاق البحث والاستقصاء", ev.get("scope")),
        ("الافتراضات", ev.get("assumptions")),
        ("المخاطر أو عدم اليقين", ev.get("risks")),
    ]
    report_fields = [(l, v) for l, v in report_fields if v]
    if report_fields:
        story += [section_header("بنود التقرير"), sp()]
        for label, value in report_fields:
            story += [full_row(label, value), sp(3)]

    # ── 11. Authors ───────────────────────────────────────────────────────────
    authors = [
        {"id": ev.get(f"author{i}Id"), "title": ev.get(f"author{i}Title")}
        for i in range(1, 5)
        if ev.get(f"author{i}Id")
    ]
    if authors:
        story += [section_header("معدي التقرير"), sp()]
        for i in range(0, len(authors), 2):
            if i + 1 < len(authors):
                a, b = authors[i], authors[i + 1]
                row = [
                    lv(f"معد {i + 2} — المنصب", b["title"]),
                    lv(f"معد {i + 2} — المعرف", b["id"]),
                    lv(f"معد {i + 1} — المنصب", a["title"]),
                    lv(f"معد {i + 1} — المعرف", a["id"]),
                ]
                t = Table([row], colWidths=[CONTENT_W / 4] * 4)
                t.setStyle(TableStyle(tbl_style_base()))
                story += [t, sp(3)]
            else:
                a = authors[i]
                story += [
                    two_col_row(
                        f"معد {i + 1} — المعرف",
                        a["id"],
                        f"معد {i + 1} — المنصب",
                        a["title"],
                    ),
                    sp(3),
                ]

    # ── 12. Image Attachments ─────────────────────────────────────────────────
    if img_atts or other_atts:
        story.append(PageBreak())
        story += [section_header("المرفقات"), sp()]

    for att in img_atts:
        story.append(PageBreak())
        story += [full_row("", att.get("name", "مرفق")), sp(6)]
        img = safe_image(att["dataUri"], CONTENT_W, PAGE_H - 80 * mm)
        if img:
            story += [img, sp(4)]

    # Other/PDF attachment listing table
    listable = other_atts  # PDFs will be merged later, just list them
    if data.get("pdfAttachments"):
        listable = data["pdfAttachments"] + other_atts
    if listable:

        def ah(t):
            return Paragraph(reshape_arabic(t), S["tbl_hdr"])

        def ad(t):
            return Paragraph(reshape_arabic(dash(t)), S["tbl_cell"])

        att_rows = [[ah("#"), ah("اسم الملف"), ah("النوع"), ah("الحجم")]]
        for i, att in enumerate(listable):
            size_kb = f"{att.get('size', 0) / 1024:.1f} KB"
            mime = att.get("mimeType", "")
            type_label = "PDF" if mime == "application/pdf" else mime
            att_rows.append(
                [
                    ad(str(i + 1)),
                    ad(att.get("name") or att.get("originalName", "")),
                    ad(type_label),
                    ad(size_kb),
                ]
            )
        att_tbl = Table(att_rows, colWidths=[20, CONTENT_W - 140, 60, 60])
        st3 = tbl_style_base()
        st3 += [
            ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), C_WHITE),
        ]
        att_tbl.setStyle(TableStyle(st3))
        story += [att_tbl, sp(8)]

    # ── 13. Property Images ─────────────────────────────────────────────────
    if images:
        story.append(PageBreak())
        story += [section_header("صور العقار"), sp()]

        for i in range(0, len(images), 2):
            left = images[i]
            right = images[i + 1] if i + 1 < len(images) else None

            def img_cell(item):
                img = safe_image(item["dataUri"], (CONTENT_W / 2) - 10, 180)
                if img is None:
                    return Paragraph("—", S["img_caption"])
                return [
                    img,
                    Spacer(1, 3),
                    Paragraph(reshape_arabic(item.get("name", "")), S["img_caption"]),
                ]

            left_cell = img_cell(left)
            right_cell = img_cell(right) if right else ""

            # RTL: right image goes in first column
            grid = Table(
                [[right_cell, left_cell]], colWidths=[CONTENT_W / 2, CONTENT_W / 2]
            )
            grid.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            story.append(grid)

    # ── Build main PDF ────────────────────────────────────────────────────────
    doc.build(
        story, onFirstPage=make_footer(assignment), onLaterPages=make_footer(assignment)
    )

    main_bytes = buf.getvalue()

    # ── Merge PDF attachments ─────────────────────────────────────────────────
    if not pdf_atts:
        return main_bytes

    writer = PdfWriter()
    writer.append(io.BytesIO(main_bytes))

    for att in pdf_atts:
        fp = att.get("filePath", "")
        if not fp:
            continue
        abs_fp = fp if os.path.isabs(fp) else os.path.join(os.getcwd(), fp)
        if not os.path.exists(abs_fp):
            print(f"[merge] PDF not found, skipping: {abs_fp}", file=sys.stderr)
            continue
        try:
            writer.append(abs_fp)
            print(f"[merge] Appended: {abs_fp}", file=sys.stderr)
        except Exception as e:
            print(f"[merge] Failed to append {abs_fp}: {e}", file=sys.stderr)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


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
