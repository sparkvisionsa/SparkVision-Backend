from __future__ import annotations

"""
page9_property_details.py — تفاصيل موقع العقار
"""


# ── Checkbox helper ────────────────────────────────────────────────────────────
def _cb(checked: bool) -> str:
    return "☑" if checked else "☐"


# ── Table cell style constants ─────────────────────────────────────────────────
_TH = (
    "background:rgba(15,139,148,0.12);color:var(--teal-primary);font-weight:700;"
    "text-align:center;padding:2.5mm 3mm;border:1px solid var(--border-light);"
)
_TD_DIR = (  # direction label (شمالي / جنوبي …)
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "color:var(--teal-primary);font-weight:700;text-align:center;"
    "background:var(--bg-table-cell);white-space:nowrap;"
)
_TD_DESC = (  # boundary description
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "text-align:right;background:var(--bg-table-cell);line-height:1.6;"
    "color:var(--text-body);"
)
_TD_LEN = (  # length value
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "text-align:center;background:var(--bg-table-cell);"
    "color:var(--teal-dark);font-weight:600;"
)
_TD_FACE = (  # facade type (static for now)
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "text-align:center;background:var(--bg-table-cell);color:var(--text-body);"
)
_TD_AREA = (  # area summary cell
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "text-align:center;background:var(--bg-table-cell);"
    "color:var(--teal-dark);font-weight:600;"
)


def _area_cell(label: str, value: str) -> str:
    v = value or "—"
    return (
        f'<td style="{_TD_AREA}">'
        f'{label}<br><span style="font-size:10pt;">{v}</span>'
        f"</td>"
    )


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})
    label_maps = data.get("labelMaps", {})

    # ── Section 1 — Location details ──────────────────────────────────────────
    region = ev.get("regionName") or "—"
    city = ev.get("cityName") or "—"
    neighborhood = ev.get("neighborhoodName") or "—"
    street = ev.get("street") or "—"
    parcel_no = ev.get("parcelNumber") or "—"
    plan_no = ev.get("planNumber") or "—"
    coords = ev.get("coords") or "—"
    deed_number = ev.get("deedNumber") or "—"
    deed_date = ev.get("deedDate") or "—"

    # Property type label
    property_type_id = ev.get("propertyTypeId") or ""
    property_type_label = (
        label_maps.get("propertyTypes", {}).get(property_type_id, "—")
        if property_type_id
        else "—"
    )

    # ── Section 2 — Property description ──────────────────────────────────────
    floors_count = ev.get("floorsCount") or ""
    appraiser_desc = ev.get("appraiserDesc") or ""

    # Build description: prefer free-text appraiserDesc, otherwise synthesise
    if appraiser_desc:
        property_desc = appraiser_desc
    elif property_type_label and property_type_label != "—":
        floors_str = f" مكون من {floors_count} أدوار" if floors_count else ""
        property_desc = f"العقار عبارة عن {property_type_label}{floors_str}"
    else:
        property_desc = "—"

    # ── Section 3 — Building state checkbox ───────────────────────────────────
    building_state_id = ev.get("buildingState") or ""
    # IDs: 10001=جديد  10002=مستخدم  10003=تحت الإنشاء  10004=أخرى
    cb_new = _cb(building_state_id == "10001")
    cb_used = _cb(building_state_id == "10002")
    cb_under_const = _cb(building_state_id == "10003")
    cb_other = _cb(building_state_id == "10004")

    completion_pct = ev.get("completionPct") or "—"

    # ── Section 4 — Boundaries & areas ────────────────────────────────────────
    north_desc = ev.get("northBoundary") or "—"
    north_len = ev.get("northLength") or "—"
    south_desc = ev.get("southBoundary") or "—"
    south_len = ev.get("southLength") or "—"
    east_desc = ev.get("eastBoundary") or "—"
    east_len = ev.get("eastLength") or "—"
    west_desc = ev.get("westBoundary") or "—"
    west_len = ev.get("westLength") or "—"

    # Areas — propertyArea = land area; buildings area not yet in schema
    land_area = ev.get("propertyArea") or "—"
    # TODO: building area (مساحة المباني) — add buildingArea field to EvalData
    building_area = "TODO: buildingArea not yet in EvalData"
    # TODO: annexes area (الملاحق) — add annexArea field to EvalData
    annex_area = "TODO: annexArea not yet in EvalData"
    # TODO: walls area (الأسوار) — add wallsArea field to EvalData
    walls_area = "TODO: wallsArea not yet in EvalData"

    # TODO: facade types per direction — not yet in schema
    # These describe whether each side faces a main street, internal street, etc.
    # Add northFacade / southFacade / eastFacade / westFacade to EvalData.
    north_facade = "TODO: northFacade not in schema"
    south_facade = "TODO: southFacade not in schema"
    east_facade = "TODO: eastFacade not in schema"
    west_facade = "TODO: westFacade not in schema"

    # ── Section 5 — Building licence ──────────────────────────────────────────
    building_license = ev.get("buildingLicense") or ""
    # buildingLicense stores "yes"/"no" or "1"/"0" — normalise to bool
    license_yes = building_license.lower() in ("yes", "1", "true", "نعم")
    cb_license_yes = _cb(license_yes)
    cb_license_no = _cb(not license_yes)

    inspection_boundaries = ev.get("inspectionBoundaries") or "معاينة ميدانية"

    # ملاحظات — appraiserNotes is the per-report notes field
    notes = ev.get("appraiserNotes") or "—"

    return f"""
<div class="page statement-page">

    <!-- WATERMARK -->
    <div class="statement-watermark">تقدير</div>

    <!-- PAGE LOGO HEADER -->
    <div class="c-page-header">
        <div class="c-page-header__logo">
            <div class="c-page-header__mark"></div>
            <div class="c-page-header__text">
                <div class="c-page-header__ar">تقدير</div>
                <div class="c-page-header__en">Taqdeer</div>
            </div>
        </div>
    </div>

    <!-- SECTION 1: تفاصيل موقع العقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading">تفاصيل موقع العقار</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:5mm;">
        <table class="c-table-compact">
            <tr>
                <td class="c-table-compact__label">المنطقة</td>
                <td class="c-table-compact__value">{region}</td>
                <td class="c-table-compact__label">المدينة</td>
                <td class="c-table-compact__value">{city}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">الحي</td>
                <td class="c-table-compact__value">{neighborhood}</td>
                <td class="c-table-compact__label">الشارع</td>
                <td class="c-table-compact__value">{street}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">رقم القطعة</td>
                <td class="c-table-compact__value">{parcel_no}</td>
                <td class="c-table-compact__label">رقم المخطط</td>
                <td class="c-table-compact__value">{plan_no}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">إحداثيات الموقع</td>
                <td class="c-table-compact__value">{coords}</td>
                <td class="c-table-compact__label">نوع العقار</td>
                <td class="c-table-compact__value">{property_type_label}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">رقم الصك</td>
                <td class="c-table-compact__value">{deed_number}</td>
                <td class="c-table-compact__label">تاريخ الصك</td>
                <td class="c-table-compact__value">{deed_date}</td>
            </tr>
        </table>
    </div>

    <!-- SECTION 2: وصف العقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading c-section-heading--pill">وصف العقار</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:5mm;">
        <p class="c-text-body">{property_desc}</p>
    </div>

    <!-- SECTION 3: حالة العقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading c-section-heading--pill">حالة العقار</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:5mm;">
        <p class="c-text-body" style="color:var(--teal-primary);font-weight:700;margin-bottom:2mm;">حالة المبنى</p>
        <div class="c-checkbox-block" style="margin-bottom:3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:25%;">{cb_new} جديد</td>
                    <td style="width:25%;">{cb_used} مستخدم</td>
                    <td style="width:25%;">{cb_under_const} تحت الإنشاء</td>
                    <td style="width:25%;">{cb_other} أخرى</td>
                </tr>
            </table>
        </div>
        <div style="display:flex;align-items:center;gap:6mm;margin-bottom:3mm;">
            <p class="c-text-body" style="color:var(--teal-primary);font-weight:700;margin:0;white-space:nowrap;">
                نسبة اكتمال البناء:
            </p>
            <div style="
                border:1px solid var(--border-light);background:var(--bg-table-cell);
                padding:2mm 6mm;border-radius:2mm;color:var(--teal-dark);
                font-weight:700;font-size:10.5pt;min-width:30mm;text-align:center;">
                {completion_pct}
            </div>
        </div>
    </div>

    <!-- SECTION 4: أبعاد وأطوال العقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading">أبعاد وأطوال العقار</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:5mm;">
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;direction:rtl;">
            <thead>
                <tr>
                    <th style="{_TH}">الجهة</th>
                    <th style="{_TH}">الوصف</th>
                    <th style="{_TH}">الطول</th>
                    <th style="{_TH}">الواجهات</th>
                    <th style="{_TH}">المساحات</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="{_TD_DIR}">شمالي</td>
                    <td style="{_TD_DESC}">{north_desc}</td>
                    <td style="{_TD_LEN}">{north_len}</td>
                    <td style="{_TD_FACE}">{north_facade}</td>
                    {_area_cell("مساحة الأرض (م²)", land_area)}
                </tr>
                <tr>
                    <td style="{_TD_DIR}">جنوبي</td>
                    <td style="{_TD_DESC}">{south_desc}</td>
                    <td style="{_TD_LEN}">{south_len}</td>
                    <td style="{_TD_FACE}">{south_facade}</td>
                    {_area_cell("مساحة المباني (م²)", building_area)}
                </tr>
                <tr>
                    <td style="{_TD_DIR}">شرقي</td>
                    <td style="{_TD_DESC}">{east_desc}</td>
                    <td style="{_TD_LEN}">{east_len}</td>
                    <td style="{_TD_FACE}">{east_facade}</td>
                    {_area_cell("الملاحق (م²)", annex_area)}
                </tr>
                <tr>
                    <td style="{_TD_DIR}">غربي</td>
                    <td style="{_TD_DESC}">{west_desc}</td>
                    <td style="{_TD_LEN}">{west_len}</td>
                    <td style="{_TD_FACE}">{west_facade}</td>
                    {_area_cell("مساحة الأسوار (م²)", walls_area)}
                </tr>
            </tbody>
        </table>
    </div>

    <!-- SECTION 5: معلومات رخصة البناء -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading c-section-heading--pill">معلومات رخصة البناء</div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:3mm;">
        <div class="c-checkbox-block" style="margin-bottom:3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:33%;color:var(--teal-primary);font-weight:700;">مطابق لرخصة البناء</td>
                    <td style="width:33%;">{cb_license_yes} نعم</td>
                    <td style="width:33%;">{cb_license_no} لا</td>
                </tr>
            </table>
        </div>
        <div class="c-checkbox-block" style="margin-bottom:3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:33%;color:var(--teal-primary);font-weight:700;">حدود المعاينة</td>
                    <td style="width:67%;">{inspection_boundaries}</td>
                </tr>
            </table>
        </div>
    </div>
    <div style="position:relative;z-index:2;margin-bottom:4mm;">
        <p class="c-text-body">
            <span class="c-highlight">ملاحظات: </span>{notes}
        </p>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">9</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
