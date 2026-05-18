from __future__ import annotations

"""
page10_finishing_utilities.py — تصنيف مستوى تشطيبات البناء / المرافق / المحيط

Dynamic fields
--------------
  ev.finishLevel  →  finish level checkbox (IDs: 23=فاخر, 24=متوسط, 25=عادي, 10006=بدون)

Everything else in this page has no corresponding EvalData field yet.
TODO fields are grouped by section below.
"""


def _cb(checked: bool) -> str:
    return "☑" if checked else "☐"


# ── Shared cell style constants ────────────────────────────────────────────────
_TH = (
    "background:rgba(15,139,148,0.06);color:var(--teal-primary);font-weight:700;"
    "text-align:center;padding:2mm 3mm;border:1px solid var(--border-light);"
)
_TD_VAL = (
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "text-align:center;background:var(--bg-table-cell);"
    "color:var(--teal-dark);font-weight:600;"
)
_SUB_HEAD = (
    "background:rgba(15,139,148,0.10);color:var(--teal-primary);font-weight:700;"
    "font-size:9.5pt;padding:2mm 4mm;border-bottom:1px solid var(--border-light);"
    "text-align:right;"
)
_INNER_BOX = (
    "position:relative;z-index:2;border:1px solid var(--border-light);"
    "border-radius:0 0 2mm 2mm;margin-bottom:5mm;overflow:hidden;"
)


def render(data: dict) -> str:
    ev = data.get("ev", {})

    # ── Section 1 — Finish level checkbox ─────────────────────────────────────
    # ✅ Dynamic — ev.finishLevel (IDs: 23=فاخر, 24=متوسط, 25=عادي, 10006=بدون)
    finish_level_id = ev.get("finishLevel") or ""
    cb_luxury = _cb(finish_level_id == "23")
    cb_medium = _cb(finish_level_id == "24")
    cb_normal = _cb(finish_level_id == "25")
    cb_none = _cb(finish_level_id == "10006")

    # ── Section 1 — Finishing description detail cells ────────────────────────
    # TODO: add these fields to EvalData — finishing material descriptions
    insulation_type = "TODO: insulationType not in EvalData"  # نوعية العزل
    ceiling_type = "TODO: ceilingType not in EvalData"  # أنواع الأسقف
    interior_doors = "TODO: interiorDoors not in EvalData"  # الأبواب الداخلية
    exterior_doors = "TODO: exteriorDoors not in EvalData"  # الأبواب الخارجية
    floor_yard = "TODO: floorYard not in EvalData"  # أرضية الأحواش
    floor_reception = "TODO: floorReception not in EvalData"  # أرضية الاستقبال
    floor_entrance = "TODO: floorEntrance not in EvalData"  # أرضية المدخل
    floor_rooms = "TODO: floorRooms not in EvalData"  # أرضية الغرف

    # ── Section 2 — Utilities ─────────────────────────────────────────────────
    # TODO: add boolean/checkbox fields to EvalData for each utility
    has_sewage = "TODO: hasSewage not in EvalData"  # الصرف الصحي
    has_phone = "TODO: hasPhone not in EvalData"  # الهاتف
    has_water = "TODO: hasWater not in EvalData"  # المياه
    has_electric = "TODO: hasElectric not in EvalData"  # الكهرباء
    # TODO: add meter count/number fields to EvalData
    water_meter_count = "TODO: waterMeterCount not in EvalData"
    electric_meter_count = "TODO: electricMeterCount not in EvalData"
    water_meter_nos = "TODO: waterMeterNos not in EvalData"
    electric_meter_nos = "TODO: electricMeterNos not in EvalData"

    # ── Section 3 — Surrounding environment ───────────────────────────────────
    # TODO: add boolean/checkbox fields to EvalData for nearby amenities
    has_mosque = "TODO: hasMosque not in EvalData"
    has_medical = "TODO: hasMedical not in EvalData"
    has_security = "TODO: hasSecurity not in EvalData"
    has_education = "TODO: hasEducation not in EvalData"
    has_commercial = "TODO: hasCommercial not in EvalData"
    has_park = "TODO: hasPark not in EvalData"
    has_government = "TODO: hasGovernment not in EvalData"
    has_highway = "TODO: hasHighway not in EvalData"

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

    <!-- SECTION 1: تصنيف مستوى تشطيبات البناء -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading">تصنيف مستوى تشطيبات البناء</div>
    </div>

    <div style="{_INNER_BOX}">

        <!-- مستوى التشطيب -->
        <div style="{_SUB_HEAD}">مستوى التشطيب</div>
        <div style="padding:3mm 4mm;border-bottom:1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border:none;">
                <tr>
                    <td style="border:1px solid var(--border-light);width:25%;">{cb_luxury} تشطيب فاخر</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{cb_medium} تشطيب متوسط</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{cb_normal} تشطيب عادي</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{cb_none} بدون تشطيب</td>
                </tr>
            </table>
        </div>

        <!-- وصف التشطيب -->
        <div style="{_SUB_HEAD}">وصف التشطيب</div>

        <!-- Doors / insulation / ceilings -->
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;direction:rtl;">
            <thead>
                <tr>
                    <th style="{_TH}width:25%;">نوعية العزل</th>
                    <th style="{_TH}width:25%;">أنواع الأسقف</th>
                    <th style="{_TH}width:25%;">الأبواب الداخلية</th>
                    <th style="{_TH}width:25%;">الأبواب الخارجية</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="{_TD_VAL}">{insulation_type}</td>
                    <td style="{_TD_VAL}">{ceiling_type}</td>
                    <td style="{_TD_VAL}">{interior_doors}</td>
                    <td style="{_TD_VAL}">{exterior_doors}</td>
                </tr>
            </tbody>
        </table>

        <!-- Floors -->
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;direction:rtl;">
            <thead>
                <tr>
                    <th style="{_TH}width:25%;">أرضية الأحواش</th>
                    <th style="{_TH}width:25%;">أرضية الاستقبال</th>
                    <th style="{_TH}width:25%;">أرضية المدخل</th>
                    <th style="{_TH}width:25%;">أرضية الغرف</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="{_TD_VAL}">{floor_yard}</td>
                    <td style="{_TD_VAL}">{floor_reception}</td>
                    <td style="{_TD_VAL}">{floor_entrance}</td>
                    <td style="{_TD_VAL}">{floor_rooms}</td>
                </tr>
            </tbody>
        </table>

    </div><!-- end section 1 box -->

    <!-- SECTION 2: الخدمات والمرافق المتوفرة بالعقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading">الخدمات والمرافق المتوفرة بالعقار</div>
    </div>

    <div style="{_INNER_BOX}">
        <div style="padding:3mm 4mm;border-bottom:1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border:none;">
                <tr>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_sewage} الصرف الصحي</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_phone} الهاتف</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_water} المياه</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_electric} الكهرباء</td>
                </tr>
            </table>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;direction:rtl;">
            <thead>
                <tr>
                    <th style="{_TH}width:25%;">عدد عدادات المياه</th>
                    <th style="{_TH}width:25%;">عدد عدادات الكهرباء</th>
                    <th style="{_TH}width:25%;">أرقام عدادات المياه</th>
                    <th style="{_TH}width:25%;">أرقام عدادات الكهرباء</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="{_TD_VAL}">{water_meter_count}</td>
                    <td style="{_TD_VAL}">{electric_meter_count}</td>
                    <td style="{_TD_VAL}">{water_meter_nos}</td>
                    <td style="{_TD_VAL}">{electric_meter_nos}</td>
                </tr>
            </tbody>
        </table>
    </div><!-- end section 2 box -->

    <!-- SECTION 3: المحيط المؤثر للعقار -->
    <div style="margin-bottom:3mm;position:relative;z-index:2;">
        <div class="c-section-heading">المحيط المؤثر للعقار</div>
    </div>

    <div style="{_INNER_BOX}">
        <div style="padding:3mm 4mm;border-bottom:1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border:none;">
                <tr>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_mosque} جامع</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_medical} مرفق طبي</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_security} مرفق أمني</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_education} مرفق تعليمي</td>
                </tr>
            </table>
        </div>
        <div style="padding:3mm 4mm;border-bottom:1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border:none;">
                <tr>
                    <td style="
                        border:1px solid var(--border-light);width:25%;
                        background:rgba(15,139,148,0.07);color:var(--teal-primary);
                        font-weight:700;text-align:right;padding:2.5mm 4mm;">
                        خدمات أخرى
                    </td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_commercial} سوق تجاري</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_park} حديقة</td>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_government} مقر حكومي</td>
                </tr>
            </table>
        </div>
        <div style="padding:3mm 4mm;">
            <table class="c-checkbox-table" style="border:none;">
                <tr>
                    <td style="border:1px solid var(--border-light);width:25%;">{has_highway} طريق سريع</td>
                    <td style="border:1px solid var(--border-light);width:75%;color:var(--text-muted);text-align:right;"></td>
                </tr>
            </table>
        </div>
    </div><!-- end section 3 box -->

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">10</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
