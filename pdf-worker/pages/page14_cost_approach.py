from __future__ import annotations

"""
page14_cost_approach.py — وصف مسطحات المبنى الرئيسي + أسلوب التكلفة (طريقة الإحلال)

Dynamic fields
--------------
  ev.replacementLines   →  table 1 rows (floor-by-floor breakdown)
    Each line: { label, use, area, meterPrice, total }

  ev.costNetBuildings   →  قيمة المبنى (gross replacement cost)
  ev.meterPriceLand     →  سعر متر الأرض (used to calc land value display)
  ev.propertyArea       →  مساحة الأرض
  ev.costNetLandPrice   →  قيمة الأرض
  ev.costLandBuildTotal →  القيمة العادلة بأسلوب التكلفة (final total)

  ev.managementPct      →  التكاليف غير المباشرة %
  ev.professionalPct    →  أرباح المطور % (professional fees)
  ev.depreciationPct    →  إجمالي الإهلاك المادي %
  ev.careerPct          →  التقادم الوظيفي %
  ev.economicPct        →  التقادم الاقتصادي %

  ev.replacementNotes   →  per-report notes (if any)
"""


def _v(val, suffix: str = "") -> str:
    s = str(val).strip() if val not in (None, "") else ""
    return f"{s}{suffix}" if s else "—"


def _pct(val) -> str:
    s = str(val).strip() if val not in (None, "") else ""
    return f"{s} %" if s else "—"


def _floor_row(row: dict, styles: dict) -> str:
    label = _v(row.get("label"))
    use = _v(row.get("use"))
    area = _v(row.get("area"))
    meter_price = _v(row.get("meterPrice"))
    total = _v(row.get("total"))
    return (
        f"<tr>"
        f'<td style="{styles["ROW_HDR"]}">{label}</td>'
        f'<td style="{styles["VAL"]}">{use}</td>'
        f'<td style="{styles["VAL"]}">{area}</td>'
        f'<td style="{styles["VAL"]}">{meter_price}</td>'
        f'<td style="{styles["VAL"]}">{total}</td>'
        f"</tr>"
    )


def render(data: dict) -> str:
    ev = data.get("ev", {})

    # ── Table 1 data ───────────────────────────────────────────────────────────
    replacement_lines: list = ev.get("replacementLines") or []

    # Total building area = sum of area values across all lines
    total_build_area = "—"
    try:
        areas = [
            float(str(r.get("area", 0)).replace(",", ""))
            for r in replacement_lines
            if r.get("area")
        ]
        if areas:
            total_build_area = f"{sum(areas):,.2f}"
    except (ValueError, TypeError):
        pass

    # ── Table 2 data ───────────────────────────────────────────────────────────
    building_area = _v(
        ev.get("propertyArea") or (total_build_area if total_build_area != "—" else "")
    )
    building_value = _v(ev.get("costNetBuildings"))
    management_pct = _pct(ev.get("managementPct"))
    developer_profit = _pct(ev.get("professionalPct"))
    depreciation_pct = _pct(ev.get("depreciationPct"))
    career_pct = _pct(ev.get("careerPct"))
    economic_pct = _pct(ev.get("economicPct"))
    land_value = _v(ev.get("costNetLandPrice"))
    final_total = _v(ev.get("costLandBuildTotal"))
    notes = ev.get("replacementNotes") or ""

    # Compute total depreciation % label (sum of three if all numeric)
    total_depr_pct = "—"
    try:
        d = float(
            str(ev.get("depreciationPct", 0) or 0).replace(",", "").replace("%", "")
        )
        c = float(str(ev.get("careerPct", 0) or 0).replace(",", "").replace("%", ""))
        e = float(str(ev.get("economicPct", 0) or 0).replace(",", "").replace("%", ""))
        total_depr_pct = f"{d + c + e:.2f} %"
    except (ValueError, TypeError):
        pass

    # Compute depreciation amount from building value and total pct
    total_depr_val = "—"
    try:
        bv = float(str(ev.get("costNetBuildings", 0) or 0).replace(",", ""))
        dp = float(
            str(ev.get("depreciationPct", 0) or 0).replace(",", "").replace("%", "")
        )
        cp = float(str(ev.get("careerPct", 0) or 0).replace(",", "").replace("%", ""))
        ep = float(str(ev.get("economicPct", 0) or 0).replace(",", "").replace("%", ""))
        total_depr_val = f"{bv * (dp + cp + ep) / 100:,.2f}"
    except (ValueError, TypeError):
        pass

    # Depreciated building value
    depr_building_val = "—"
    try:
        bv2 = float(str(ev.get("costNetBuildings", 0) or 0).replace(",", ""))
        pct_sum = float(
            str(ev.get("depreciationPct", 0) or 0).replace(",", "").replace("%", "")
        )
        pct_sum += float(
            str(ev.get("careerPct", 0) or 0).replace(",", "").replace("%", "")
        )
        pct_sum += float(
            str(ev.get("economicPct", 0) or 0).replace(",", "").replace("%", "")
        )
        depr_building_val = f"{bv2 * (1 - pct_sum / 100):,.2f}"
    except (ValueError, TypeError):
        pass

    # ── Style constants ────────────────────────────────────────────────────────
    TH = (
        "background:rgba(15,139,148,0.12);color:var(--teal-primary);"
        "font-weight:700;text-align:center;padding:2.5mm 3mm;"
        "border:1px solid var(--border-light);font-size:9pt;vertical-align:middle;"
    )
    ROW_HDR = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:var(--teal-primary);font-weight:700;text-align:right;"
        "background:rgba(15,139,148,0.07);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;"
    )
    VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--bg-table-cell);"
        "color:var(--teal-dark);font-weight:600;font-size:9pt;vertical-align:middle;"
    )
    TOT_LBL = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:white;font-weight:700;text-align:right;"
        "background:var(--teal-primary);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;"
    )
    TOT_VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--teal-primary);"
        "color:white;font-weight:700;font-size:9pt;vertical-align:middle;"
    )
    CA_LBL = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:var(--teal-primary);font-weight:700;text-align:right;"
        "background:rgba(15,139,148,0.07);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;width:38%;"
    )
    CA_PCT = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--bg-table-cell);"
        "color:var(--text-muted);font-size:9pt;vertical-align:middle;width:16%;"
    )
    CA_VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--bg-table-cell);"
        "color:var(--teal-dark);font-weight:600;font-size:9pt;vertical-align:middle;width:46%;"
    )
    CA_TOT_LBL = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:white;font-weight:700;text-align:right;"
        "background:var(--teal-primary);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;"
    )
    CA_TOT_VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--teal-primary);"
        "color:white;font-weight:700;font-size:9pt;vertical-align:middle;"
    )
    CA_SINGLE_LBL = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:var(--teal-dark);font-weight:700;text-align:right;"
        "background:rgba(15,139,148,0.04);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;"
    )
    CA_SINGLE_VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:rgba(15,139,148,0.04);"
        "color:var(--teal-dark);font-weight:700;font-size:9.5pt;vertical-align:middle;"
    )
    CA_TOT2_LBL = (
        "border:1px solid var(--border-light);padding:2.5mm 4mm;"
        "color:white;font-weight:700;text-align:right;"
        "background:var(--teal-dark);font-size:9pt;"
        "vertical-align:middle;white-space:nowrap;"
    )
    CA_TOT2_VAL = (
        "border:1px solid var(--border-light);padding:2.5mm 3mm;"
        "text-align:center;background:var(--teal-dark);"
        "color:white;font-weight:700;font-size:9pt;vertical-align:middle;"
    )
    DEPR_HDR = (
        "border:1px solid var(--border-light);padding:2mm 4mm;"
        "color:var(--teal-dark);font-weight:700;text-align:right;"
        "background:rgba(15,139,148,0.15);font-size:8.5pt;"
        "vertical-align:middle;font-style:italic;"
    )

    styles = {"ROW_HDR": ROW_HDR, "VAL": VAL}

    # ── Table 1 rows ───────────────────────────────────────────────────────────
    floor_rows_html = (
        "".join(_floor_row(r, styles) for r in replacement_lines)
        if replacement_lines
        else f'<tr><td colspan="5" style="{VAL}">لا توجد بيانات مسطحات</td></tr>'
    )

    # Notes
    notes_html = (
        f'<p class="c-text-body" style="font-size:9pt;">{notes}</p>' if notes else ""
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

    <!-- TABLE 1: وصف مسطحات (المبنى الرئيسي) -->
    <div style="margin-bottom:2mm;position:relative;z-index:2;">
        <div class="c-section-heading">وصف مسطحات (المبنى الرئيسي)</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:6mm;">
        <table style="width:100%;border-collapse:collapse;font-size:9pt;direction:rtl;">
            <thead>
                <tr>
                    <th style="{TH} width:30%;"> </th>
                    <th style="{TH} width:23%;">الاستخدام</th>
                    <th style="{TH} width:15%;">المساحة</th>
                    <th style="{TH} width:16%;">سعر المتر</th>
                    <th style="{TH} width:16%;">الإجمالي</th>
                </tr>
            </thead>
            <tbody>
                {floor_rows_html}
                <tr>
                    <td style="{TOT_LBL}" colspan="3">إجمالي مسطحات البناء مع الأسوار</td>
                    <td style="{TOT_VAL}">{total_build_area}</td>
                    <td style="{TOT_VAL}">—</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- TABLE 2: أسلوب التكلفة (طريقة الإحلال) -->
    <div style="margin-bottom:2mm;position:relative;z-index:2;">
        <div class="c-section-heading">أسلوب التكلفة (طريقة الإحلال)</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:4mm;">
        <table style="width:100%;border-collapse:collapse;font-size:9pt;direction:rtl;">
            <tbody>
                <tr>
                    <td style="{CA_LBL}">مساحة المبنى</td>
                    <td style="{CA_PCT}">—</td>
                    <td style="{CA_VAL}">{building_area}</td>
                </tr>
                <tr>
                    <td style="{CA_LBL}">قيمة المبنى</td>
                    <td style="{CA_PCT}">—</td>
                    <td style="{CA_VAL}">{building_value}</td>
                </tr>
                <tr>
                    <td style="{CA_LBL}">التكاليف المباشرة</td>
                    <td style="{CA_PCT}">100 %</td>
                    <td style="{CA_VAL}">{building_value}</td>
                </tr>
                <tr>
                    <td style="{CA_LBL}">التكاليف غير المباشرة</td>
                    <td style="{CA_PCT}">{management_pct}</td>
                    <td style="{CA_VAL}">—</td>
                </tr>
                <tr>
                    <td style="{CA_LBL}">أرباح المطور</td>
                    <td style="{CA_PCT}">{developer_profit}</td>
                    <td style="{CA_VAL}">—</td>
                </tr>
                <!-- Depreciation sub-section -->
                <tr><td colspan="3" style="{DEPR_HDR}">الإهلاك</td></tr>
                <tr>
                    <td style="{CA_LBL};padding-right:8mm;">التقادم - 1 المادي</td>
                    <td style="{CA_PCT}">{depreciation_pct}</td>
                    <td style="{CA_VAL}">{total_depr_val}</td>
                </tr>
                <tr>
                    <td style="{CA_LBL};padding-right:8mm;">التقادم - 2 الوظيفي</td>
                    <td style="{CA_PCT}">{career_pct}</td>
                    <td style="{CA_VAL}">0.00</td>
                </tr>
                <tr>
                    <td style="{CA_LBL};padding-right:8mm;">التقادم - 3 الاقتصادي</td>
                    <td style="{CA_PCT}">{economic_pct}</td>
                    <td style="{CA_VAL}">0.00</td>
                </tr>
                <tr>
                    <td style="{CA_TOT_LBL}">إجمالي الإهلاك</td>
                    <td style="{CA_TOT_VAL}">{total_depr_pct}</td>
                    <td style="{CA_TOT_VAL}">{total_depr_val}</td>
                </tr>
                <tr><td colspan="3" style="padding:1mm;border:none;background:transparent;"></td></tr>
                <tr>
                    <td style="{CA_SINGLE_LBL}">القيمة المهلكة للمباني</td>
                    <td colspan="2" style="{CA_SINGLE_VAL}">{depr_building_val}</td>
                </tr>
                <tr>
                    <td style="{CA_SINGLE_LBL}">قيمة الأرض</td>
                    <td colspan="2" style="{CA_SINGLE_VAL}">{land_value}</td>
                </tr>
                <tr>
                    <td style="{CA_TOT2_LBL}">القيمة العادلة بأسلوب التكلفة</td>
                    <td colspan="2" style="{CA_TOT2_VAL};font-size:10pt;">{final_total}</td>
                </tr>
            </tbody>
        </table>
    </div>

    {notes_html}

    <div class="statement-footer">
        <div class="footer-ribbon"><div class="footer-page">14</div></div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
