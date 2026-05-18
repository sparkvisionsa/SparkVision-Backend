from __future__ import annotations

"""
page13_comparables.py — العقارات المقارنة + جدول التسويات

Dynamic fields
--------------
  ev.comparisonRows   →  comparables table (filtered to inReport != false)
  ev.settlementRows   →  settlement adjustment rows
  ev.settlementBases  →  subject property values per row label
  ev.settlementWeights →  weighted contribution per comparable
  ev.marketMeterPrice →  صافي سعر المتر بعد الوزن النسبي
  ev.marketMethodTotal →  القيمة الإجمالية بطريقة المقارنات
  ev.marketReason     →  notes paragraph

comparisonRows expected shape (one item per comparable):
  { name, propertyType, operationType, area, date, meterPrice, total,
    coordinates, source }

settlementRows expected shape (one item per adjustment factor):
  { label, subjectValue, values: [v1, v2, v3, ...] }

settlementBases: list of subject column values aligned to settlementRows
settlementWeights: list of weight % strings aligned to comparisonRows
"""


# ── Shared style constants ─────────────────────────────────────────────────────
_TH = (
    "background:rgba(15,139,148,0.12);color:var(--teal-primary);"
    "font-weight:700;text-align:center;padding:2mm 2.5mm;"
    "border:1px solid var(--border-light);font-size:8.5pt;vertical-align:middle;"
)
_ROW_HDR = (
    "border:1px solid var(--border-light);padding:2mm 3mm;"
    "color:var(--teal-primary);font-weight:700;text-align:right;"
    "background:rgba(15,139,148,0.07);font-size:8.5pt;"
    "vertical-align:middle;white-space:nowrap;"
)
_VAL = (
    "border:1px solid var(--border-light);padding:2mm 2.5mm;"
    "text-align:center;background:var(--bg-table-cell);"
    "color:var(--teal-dark);font-weight:600;font-size:8.5pt;vertical-align:middle;"
)
_VAL_SUBJ = (
    "border:1px solid var(--border-light);padding:2mm 2.5mm;"
    "text-align:center;background:rgba(15,139,148,0.05);"
    "color:var(--teal-dark);font-weight:700;font-size:8.5pt;vertical-align:middle;"
)
_VAL_MUTED = (
    "border:1px solid var(--border-light);padding:2mm 2.5mm;"
    "text-align:right;background:rgba(15,139,148,0.04);"
    "color:var(--text-muted);font-size:8pt;vertical-align:middle;"
)
_TOTAL_VAL = (
    "border:1px solid var(--border-light);padding:2.5mm 4mm;"
    "text-align:center;font-weight:700;font-size:9.5pt;vertical-align:middle;"
)
_SUBTOTAL = (
    "border:1px solid var(--border-light);padding:2mm 2.5mm;"
    "text-align:center;font-weight:700;font-size:8.5pt;vertical-align:middle;"
    "background:rgba(15,139,148,0.04);color:var(--teal-dark);"
)

# Notes boilerplate — TODO: move to Company/report-config model
_NOTES = [
    "بعد معاينة المنطقة المحيطة بالعقار تم الوصول إلى صفقات منفذة وعروض قائمة، والاستناد على "
    "هذه المعلومات مع التأكد من أن أسعار العرض مناسبة ومشابهة لأسعار السوق المحيطة عن طريق "
    "التأكد من قاعدة بيانات لدينا والتواصل مع بعض وكلاء العقاريين في المنطقة المعنية.",
    "تم إجراء عملية التسويات والتعديلات حسب ما هو متعارف في السوق واستناداً على ما هو معروض "
    "بالسوق. إضافة إلى أنه تم تقدير نسب التعديلات كنسب مئوية % حسب خبرة المقيم.",
    "قيمة التسوية للمتر المربع تم حسابها وفقاً للتعديلات المذكورة في العوامل المختلفة "
    "مثل المساحة وعرض الشارع وسهولة الوصول.",
]


def _v(val) -> str:
    """Return val as string, falling back to em-dash."""
    return str(val) if val not in (None, "", []) else "—"


def _comp_row(idx: int, row: dict) -> str:
    name = _v(row.get("name") or f"المقارنة {idx + 1}")
    prop_type = _v(row.get("propertyType"))
    op_type = _v(row.get("operationType"))
    area = _v(row.get("area"))
    date = _v(row.get("date"))
    meter_price = _v(row.get("meterPrice"))
    total = _v(row.get("total"))
    coords = _v(row.get("coordinates"))
    source = _v(row.get("source"))
    return (
        f"<tr>"
        f'<td style="{_ROW_HDR}">{name}</td>'
        f'<td style="{_VAL}">{prop_type}</td>'
        f'<td style="{_VAL}">{op_type}</td>'
        f'<td style="{_VAL}">{area}</td>'
        f'<td style="{_VAL}">{date}</td>'
        f'<td style="{_VAL}">{meter_price}</td>'
        f'<td style="{_VAL}">{total}</td>'
        f'<td style="{_VAL};font-size:7.5pt;">{coords}</td>'
        f'<td style="{_VAL};font-size:7.5pt;">{source}</td>'
        f"</tr>"
    )


def _settlement_row(
    label: str, subject_val: str, comp_vals: list, highlight: bool = False
) -> str:
    subj_td = _VAL_SUBJ if subject_val != "—" else _VAL_MUTED
    row_bg = ' style="background:rgba(15,139,148,0.04);"' if highlight else ""
    cells = "".join(
        f'<td style="{_SUBTOTAL if highlight else _VAL}">{_v(v)}</td>'
        for v in comp_vals
    )
    return (
        f"<tr{row_bg}>"
        f'<td style="{_ROW_HDR}">{label}</td>'
        f'<td style="{subj_td}">{subject_val}</td>'
        f"{cells}"
        f"</tr>"
    )


def render(data: dict) -> str:
    ev = data.get("ev", {})

    # ── Comparables ────────────────────────────────────────────────────────────
    comp_rows: list = [
        r for r in (ev.get("comparisonRows") or []) if r.get("inReport") is not False
    ]
    n = len(comp_rows)

    # ── Settlement data ────────────────────────────────────────────────────────
    settlement_rows: list = ev.get("settlementRows") or []
    settlement_weights: list = ev.get("settlementWeights") or []

    # Totals
    meter_price_net = _v(ev.get("marketMeterPrice"))
    market_total = _v(ev.get("marketMethodTotal"))
    market_reason = ev.get("marketReason") or ""

    # ── Build comparables thead (dynamic column count) ─────────────────────────
    comp_th_cols = (
        f'<th style="{_TH} width:10%;">البند</th>'
        f'<th style="{_TH} width:9%;">نوع العقار</th>'
        f'<th style="{_TH} width:9%;">نوع العملية</th>'
        f'<th style="{_TH} width:9%;">المساحة</th>'
        f'<th style="{_TH} width:11%;">تاريخ العملية</th>'
        f'<th style="{_TH} width:10%;">السعر (م²)</th>'
        f'<th style="{_TH} width:13%;">الإجمالي</th>'
        f'<th style="{_TH} width:16%;">الإحداثيات</th>'
        f'<th style="{_TH}">المصدر</th>'
    )
    comp_rows_html = (
        "".join(_comp_row(i, r) for i, r in enumerate(comp_rows))
        if comp_rows
        else f'<tr><td colspan="9" style="{_VAL}">لا توجد مقارنات</td></tr>'
    )

    # ── Build settlement thead ─────────────────────────────────────────────────
    comp_labels = [
        r.get("name") or f"المقارنة {i + 1}" for i, r in enumerate(comp_rows)
    ]
    sett_th = (
        f'<th style="{_TH} width:22%;">البند</th>'
        f'<th style="{_TH} width:19%;">محل التقييم</th>'
        + "".join(f'<th style="{_TH}">{lbl}</th>' for lbl in comp_labels)
    )

    # ── Build settlement body rows ─────────────────────────────────────────────
    sett_rows_html = ""
    for sr in settlement_rows:
        label = _v(sr.get("label"))
        subject_val = _v(sr.get("subjectValue"))
        vals = sr.get("values") or (["—"] * n)
        highlight = bool(sr.get("isTotal") or sr.get("highlight"))
        sett_rows_html += _settlement_row(label, subject_val, vals, highlight)

    # Weights row
    if settlement_weights:
        weight_cells = "".join(
            f'<td style="{_SUBTOTAL}">{_v(w)}</td>' for w in settlement_weights[:n]
        )
        sett_rows_html += (
            f'<tr style="background:rgba(15,139,148,0.04);">'
            f'<td style="{_ROW_HDR}">المرجح الموزون</td>'
            f'<td style="{_VAL_MUTED}">—</td>'
            f"{weight_cells}</tr>"
        )

    # Net meter price + total rows (span all comp columns)
    span = n + 1  # subject col + comp cols
    sett_rows_html += (
        f'<tr style="background:rgba(15,139,148,0.08);">'
        f'<td style="{_ROW_HDR}">صافي سعر المتر بعد الوزن النسبي للتسويات</td>'
        f'<td colspan="{span}" style="{_TOTAL_VAL}background:rgba(15,139,148,0.08);color:var(--teal-dark);">'
        f"{meter_price_net}</td></tr>"
        f'<tr style="background:rgba(15,139,148,0.12);">'
        f'<td style="{_ROW_HDR}">القيمة الإجمالية بطريقة المقارنات</td>'
        f'<td colspan="{span}" style="{_TOTAL_VAL}background:rgba(15,139,148,0.12);color:var(--teal-dark);font-size:10pt;">'
        f"{market_total}</td></tr>"
    )

    # Notes
    notes_html = ""
    if market_reason:
        notes_html += f'<p class="c-text-body" style="font-size:9pt;line-height:1.7;">{market_reason}</p>'
    for note in _NOTES:
        notes_html += f'<p class="c-text-body" style="font-size:9pt;line-height:1.7;">- {note}</p>'

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

    <!-- TABLE 1: العقارات المقارنة -->
    <div style="margin-bottom:2mm;position:relative;z-index:2;">
        <div class="c-section-heading">العقارات المقارنة</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:5mm;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt;direction:rtl;">
            <thead><tr>{comp_th_cols}</tr></thead>
            <tbody>{comp_rows_html}</tbody>
        </table>
    </div>

    <!-- TABLE 2: التسويات -->
    <div style="margin-bottom:2mm;position:relative;z-index:2;">
        <div class="c-section-heading">التسويات</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:4mm;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt;direction:rtl;">
            <thead><tr>{sett_th}</tr></thead>
            <tbody>{sett_rows_html}</tbody>
        </table>
    </div>

    <!-- Notes -->
    <div style="position:relative;z-index:2;margin-bottom:4mm;">
        <span class="c-highlight">ملاحظات: </span>
        {notes_html}
    </div>

    <div class="statement-footer">
        <div class="footer-ribbon"><div class="footer-page">13</div></div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
