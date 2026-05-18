from __future__ import annotations

# ── Checkbox helpers ───────────────────────────────────────────────────────────


def _cb(checked: bool) -> str:
    return "☑" if checked else "☐"


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})
    label_maps = data.get("labelMaps", {})

    # ── Dynamic fields from DB ─────────────────────────────────────────────────
    client_name = ev.get("clientName") or "—"
    final_value = ev.get("finalAssetValue") or "—"
    final_value_txt = ev.get("finalAssetValueText") or "—"
    eval_date = ev.get("evalDate") or "—"

    # Appraiser fields — live in ev (filled by the valuation page)
    appraiser_name = ev.get("appraiserName") or "—"
    membership_no = ev.get("membershipNo") or "—"
    membership_cat = ev.get("membershipCategory") or "—"
    appraiser_title = ev.get("appraiserTitle") or "—"

    # Location for the intro sentence
    city_name = ev.get("cityName") or "—"
    neighborhood = ev.get("neighborhoodName") or ""

    # Resolve property type label
    property_type_id = ev.get("propertyTypeId") or tx.get("propertyTypeId") or ""
    property_type_label = (
        label_maps.get("propertyTypes", {}).get(property_type_id, "العقار")
        if property_type_id
        else "العقار"
    )

    # Resolve ownership type label
    ownership_type_id = tx.get("ownershipType", "")
    ownership_label = (
        label_maps.get("ownershipTypes", {}).get(ownership_type_id, "الملكية المطلقة")
        if ownership_type_id
        else "الملكية المطلقة"
    )

    # Resolve valuation basis → drives the top checkbox row
    valuation_basis_id = tx.get("valuationBasis", "")
    valuation_basis = (
        label_maps.get("valuationBases", {}).get(valuation_basis_id, "")
        if valuation_basis_id
        else ""
    )

    # Resolve valuation hypothesis → drives the bottom checkbox row
    hypothesis_id = tx.get("valuationHypothesis", "")
    hypothesis = (
        label_maps.get("valuationHypotheses", {}).get(hypothesis_id, "")
        if hypothesis_id
        else ""
    )

    # ── Valuation basis checkboxes ─────────────────────────────────────────────
    # IDs: 1=القيمة السوقية  2=القيمة الاستثمارية  3=القيمة المنصفة / 8=القيمة العادلة
    cb_market = _cb(valuation_basis_id in ("1", "7"))
    cb_investment = _cb(valuation_basis_id == "2")
    cb_fair = _cb(valuation_basis_id in ("3", "8"))

    # ── Valuation hypothesis checkboxes ───────────────────────────────────────
    # IDs: 1=الاستخدام الحالي  2=الاستخدام الأعلى والأفضل  3=التصفية المنظمة  4=البيع القسري
    cb_current_use = _cb(hypothesis_id == "1")
    cb_highest = _cb(hypothesis_id == "2")
    cb_special = _cb(hypothesis_id in ("3", "4"))

    # ── Build intro location string ────────────────────────────────────────────
    location_parts = [p for p in [city_name, neighborhood] if p and p != "—"]
    location_str = "، ".join(location_parts) if location_parts else "—"

    # ── Valuation basis label for the value block prose ───────────────────────
    basis_label = valuation_basis or "القيمة العادلة"

    # ── Static / not-yet-integrated ───────────────────────────────────────────
    # TODO: pull from Company model — client's business activity description
    client_activity = "ذات الأنشطة العقارية"

    return f"""
<div class="page statement-page">

    <!-- WATERMARK -->
    <div class="statement-watermark">تقدير</div>

    <!-- COMPONENT 1: PAGE LOGO HEADER -->
    <div class="c-page-header">
        <div class="c-page-header__logo">
            <div class="c-page-header__mark"></div>
            <div class="c-page-header__text">
                <div class="c-page-header__ar">تقدير</div>
                <div class="c-page-header__en">Taqdeer</div>
            </div>
        </div>
    </div>

    <!-- INTRO -->
    <div class="statement-intro">
        <p class="c-text-primary">
            بناءً على طلب العميل / <span class="c-highlight">{client_name}</span>
            {client_activity}، بتقييم ({property_type_label}) بـ{location_str}، ملكية ({ownership_label}).
        </p>
        <p class="c-text-body">
            وبناءً على الترخيص الممنوح لنا من قبل الهيئة السعودية للمقيمين المعتمدين،
            واتباعًا لمعايير التقييم الدولية IVS السارية حتى 31 يناير 2025، وبناءً على
            الكشف الفعلي على موقع العقار ومعاينته ميدانيًا، ووفقًا لأخلاقيات المهنة
            والقواعد المتعارف عليها، وللوصول إلى التقييم النهائي الحيادي، وبعد إجراء
            دراسة للمنطقة المحيطة بالعقار والمستندات والعقود اللازمة، تم التوصل إلى
            ({basis_label}) باستخدام:
        </p>
    </div>

    <!-- SECTION HEADING + CHECKBOX TABLE -->
    <div class="c-checkbox-block">
        <div class="c-section-heading">أسلوب أو فرضية القيمة المستخدمة</div>
        <table class="c-checkbox-table">
            <tr>
                <td>{cb_market} قيمة سوقية</td>
                <td>{cb_investment} قيمة استثمارية</td>
                <td>{cb_fair} قيمة عادلة</td>
            </tr>
            <tr>
                <td>{cb_current_use} استخدام حالي</td>
                <td>{cb_highest} الاستخدام الأعلى والأفضل</td>
                <td>{cb_special} قيمة خاصة</td>
            </tr>
        </table>
    </div>

    <!-- VALUE BLOCK -->
    <div class="statement-value">
        <p class="c-text-body">
            نقدًا للقيمة العادلة لغرض المحاسبة وفقًا لتاريخ التقييم (تاريخ القياس).
        </p>
        <p class="c-text-primary">
            بعد الأخذ بالاعتبار جميع البيانات والمبادئ المنصوص عليها، فإننا نرى أن:
        </p>
        <p class="c-text-primary">
            قيمة العقار مبلغ وقدره ({final_value}).
        </p>
        <p class="c-text-primary">
            {final_value_txt}.
        </p>
    </div>

    <!-- COMPACT TABLE — appraiser details -->
    <div style="margin-top:10mm;position:relative;z-index:2;">
        <table class="c-table-compact">
            <tr>
                <td class="c-table-compact__label">الاسم</td>
                <td class="c-table-compact__value">{appraiser_name}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">رقم العضوية</td>
                <td class="c-table-compact__value">{membership_no}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">فئة العضوية</td>
                <td class="c-table-compact__value">{membership_cat}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">صفته</td>
                <td class="c-table-compact__value">{appraiser_title}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">تاريخ التقييم (تاريخ القياس)</td>
                <td class="c-table-compact__value">{eval_date}</td>
            </tr>
        </table>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">2</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
