from __future__ import annotations

"""
page3_scope.py — المقيّم المعتمد + نطاق العمل
"""


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})
    ap = data.get("ap", {})  # TODO: wire from Users model
    label_maps = data.get("labelMaps", {})

    # ── Section 1 — Appraiser licence ─────────────────────────────────────────
    # TODO: all four fields come from the Users / Appraiser model, not yet integrated
    appraiser_name = ap.get("name") or "TODO: appraiser name from Users model"
    licence_no = ap.get("licenceNo") or "TODO: licence number from Users model"
    licence_date_h = (
        ap.get("licenceDateH") or "TODO: licence issue date (Hijri) from Users model"
    )
    licence_expiry_h = (
        ap.get("licenceExpiryH") or "TODO: licence expiry date (Hijri) from Users model"
    )

    # ── Section 2 — Scope of work ──────────────────────────────────────────────

    # Fully dynamic
    client_name = ev.get("clientName") or "—"
    authorized_rep = ev.get("authorizedName") or client_name  # authorizedName in schema
    other_users = ev.get("otherUsers") or client_name
    eval_date = ev.get("evalDate") or "—"
    report_date = ev.get("reportDate") or "—"

    # assignmentDate lives on tx, not ev
    assignment_date = tx.get("assignmentDate") or "—"

    # Resolve valuation purpose label via labelMaps
    valuation_purpose_id = tx.get("valuationPurpose", "")
    valuation_purpose = (
        label_maps.get("valuationPurposes", {}).get(valuation_purpose_id, "—")
        if valuation_purpose_id
        else "—"
    )

    # Resolve valuation basis label + build full definition sentence
    valuation_basis_id = tx.get("valuationBasis", "")
    valuation_basis_label = (
        label_maps.get("valuationBases", {}).get(valuation_basis_id, "")
        if valuation_basis_id
        else ""
    )
    # The value-basis cell shows the label + a standard IVS definition note
    if valuation_basis_label:
        value_basis = (
            f"{valuation_basis_label} — يُعرّف معيار إعداد التقارير المالية الدولي رقم 13 "
            f"«{valuation_basis_label}» بأنها السعر الذي يتم الحصول عليه من بيع أصل أو دفعه "
            f"لنقل التزام في صفقة. المصدر: معايير التقييم الدولية IVS السارية من 31 يناير 2025."
        )
    else:
        value_basis = "—"

    # Resolve valuation hypothesis label
    hypothesis_id = tx.get("valuationHypothesis", "")
    value_hypothesis = (
        label_maps.get("valuationHypotheses", {}).get(hypothesis_id, "—")
        if hypothesis_id
        else "—"
    )

    # intendedUse lives on tx
    intended_use = tx.get("intendedUse") or "—"

    # standards and scope live on ev (filled by valuation page)
    standards = ev.get("standards") or "—"

    # ── Static / not-yet-integrated ───────────────────────────────────────────
    # TODO: inspectionDate — not in current schema, add to EvalData
    inspection_date = "TODO: inspectionDate not yet in EvalData schema"

    # TODO: appraiserStatus — narrative text set per-report, add to EvalData or Users model
    appraiser_status = (
        "TODO: appraiserStatus from EvalData — نؤكد أننا قمنا بإجراء التقييم "
        "بصفتنا مثمنًا خارجيًا مؤهلاً لأغراض التقييم ولدينا المعرفة والمهارات اللازمة."
    )

    # TODO: reportType — add to EvalData or tx schema
    report_type = "TODO: reportType — تقرير سردي تفصيلي (add to schema)"

    # TODO: deliveryMethod — add to tx schema
    delivery_method = "TODO: deliveryMethod — إخطار بريدي إلكتروني (add to schema)"

    # TODO: currency — likely always SAR but add to tx if multi-currency needed
    currency = (
        "TODO: currency — الريال السعودي (add to schema or hard-code if always SAR)"
    )

    # TODO: independenceDecl — boilerplate per company, comes from Company model
    independence_decl = (
        "TODO: independenceDecl from Company model — "
        "نُقر بأننا لا يوجد لدينا أي اهتمام خاص بالعقارات ولا يوجد تضارب في المصالح."
    )

    # TODO: externalExpert — filled per-report, add to EvalData
    external_expert = (
        "TODO: externalExpert from EvalData — "
        "لم يتم الاستعانة بأي أخصائي خارجي أثناء تنفيذ هذه المهمة."
    )

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

    <!-- ── SECTION 1: المقيّم المعتمد ──────────────────────────── -->
    <div style="margin-bottom:8mm;position:relative;z-index:2;">
        <div class="c-section-heading">المقيّم المعتمد</div>
        <table class="c-table-double">
            <tr>
                <td class="c-table-double__label">الاسم</td>
                <td class="c-table-double__value">{appraiser_name}</td>
                <td class="c-table-double__label">تاريخ الترخيص</td>
                <td class="c-table-double__value">{licence_date_h}</td>
            </tr>
            <tr>
                <td class="c-table-double__label">رقم الترخيص المهني</td>
                <td class="c-table-double__value">{licence_no}</td>
                <td class="c-table-double__label">تاريخ انتهاء الترخيص</td>
                <td class="c-table-double__value">{licence_expiry_h}</td>
            </tr>
        </table>
    </div>

    <!-- ── SECTION 2: نطاق العمل ───────────────────────────────── -->
    <div style="position:relative;z-index:2;">
        <div class="c-section-heading">نطاق العمل</div>
        <table class="c-table-narrative">
            <tr>
                <td class="c-table-narrative__label">العميل</td>
                <td class="c-table-narrative__value">{client_name}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">المفوض بطلب التقييم</td>
                <td class="c-table-narrative__value">{authorized_rep}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">المستخدمون الآخرون</td>
                <td class="c-table-narrative__value">{other_users}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">حالة المقيم</td>
                <td class="c-table-narrative__value">{appraiser_status}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">العقار محل التقييم</td>
                <td class="c-table-narrative__value">{_property_desc(ev, label_maps)}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">الغرض من التقييم</td>
                <td class="c-table-narrative__value">{valuation_purpose}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">أساس القيمة</td>
                <td class="c-table-narrative__value">{value_basis}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">فرضية القيمة</td>
                <td class="c-table-narrative__value">{value_hypothesis}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">الاستخدام المقصود</td>
                <td class="c-table-narrative__value">{intended_use}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">تاريخ التقييم (تاريخ القياس)</td>
                <td class="c-table-narrative__value">{eval_date}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">تاريخ المعاينة</td>
                <td class="c-table-narrative__value">{inspection_date}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">تاريخ إصدار التقرير</td>
                <td class="c-table-narrative__value">{report_date}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">تاريخ التكليف</td>
                <td class="c-table-narrative__value">{assignment_date}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">نوع التقرير</td>
                <td class="c-table-narrative__value">{report_type}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">طريقة التسليم</td>
                <td class="c-table-narrative__value">{delivery_method}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">عملة التقييم</td>
                <td class="c-table-narrative__value">{currency}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">معايير التقييم</td>
                <td class="c-table-narrative__value">{standards}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">إقرار بالاستقلالية وعدم تضارب المصالح</td>
                <td class="c-table-narrative__value">{independence_decl}</td>
            </tr>
            <tr>
                <td class="c-table-narrative__label">الاستعانة بأخصائي</td>
                <td class="c-table-narrative__value">{external_expert}</td>
            </tr>
        </table>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">3</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""


def _property_desc(ev: dict, label_maps: dict) -> str:
    """Build the property description sentence from available ev fields."""
    property_type_id = ev.get("propertyTypeId", "")
    property_type_label = (
        label_maps.get("propertyTypes", {}).get(property_type_id, "")
        if property_type_id
        else ""
    )
    city = ev.get("cityName", "")
    neighborhood = ev.get("neighborhoodName", "")

    parts = [p for p in [neighborhood, city] if p]
    location = "، ".join(parts)

    if property_type_label and location:
        return f"العقار عبارة عن {property_type_label} في {location}"
    elif property_type_label:
        return f"العقار عبارة عن {property_type_label}"
    elif location:
        return f"عقار في {location}"
    return "—"
