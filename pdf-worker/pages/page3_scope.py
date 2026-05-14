"""
page3_scope.py — المقيّم المعتمد + نطاق العمل

Components used
---------------
  .c-page-header                    →  logo header
  .c-section-heading                →  teal section bar (both sections)
  .c-table-double                   →  four-col label/value for appraiser licence
  .c-table-narrative                →  narrow-label / wide-value for scope rows
  .c-text-tiny                      →  footer meta text
"""


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})
    ap = data.get("ap", {})  # appraiser block

    # ── Section 1 data ────────────────────────────────────────────
    appraiser_name = ap.get("name") or "حمد بن عبدالله بن ناصر الحمد"
    licence_no = ap.get("licenceNo") or "1210000414"
    licence_date_h = ap.get("licenceDateH") or "24-04-1438 هـ"
    licence_expiry_h = ap.get("licenceExpiryH") or "29-04-1448 هـ"

    # ── Section 2 data ────────────────────────────────────────────
    client_name = (
        ev.get("clientName")
        or "شركة نجوم السلام للاستثمار والتطوير العقاري (شركة شخص واحد ذ.م.م)"
    )
    authorized_rep = ev.get("authorizedRep") or client_name
    other_users = ev.get("otherUsers") or client_name
    appraiser_status = (
        ev.get("appraiserStatus")
        or "نؤكد أننا قمنا بإجراء التقييم بصفتنا مثمنًا خارجيًا مؤهلاً لأغراض التقييم ولدينا المعرفة والمهارات اللازمة للفهم الكامل."
    )
    property_desc = ev.get("propertyDesc") or "العقار عبارة عن مجمع تجاري"
    valuation_purpose = tx.get("valuationPurpose") or "أغراض المحاسبة"
    value_basis = tx.get("valueBasis") or (
        "القيمة العادلة — يُعرّف معيار إعداد التقارير المالية الدولي رقم 13 «القيمة العادلة» بأنها "
        "السعر الذي يتم الحصول عليه من بيع أصل أو دفعه لنقل التزام في صفقة."
        " المصدر: معايير التقييم الدولية IVS السارية من 31 يناير 2025."
    )
    value_hypothesis = tx.get("valueHypothesis") or "الاستخدام الأعلى والأفضل"
    intended_use = (
        tx.get("intendedUse") or "يُستخدم التقرير لدعم إعداد التقارير المالية."
    )
    eval_date = ev.get("evalDate") or "15-12-2025"
    inspection_date = ev.get("inspectionDate") or "13-12-2025"
    report_date = ev.get("reportDate") or "15-12-2025"
    assignment_date = ev.get("assignmentDate") or "09-12-2025"
    report_type = (
        tx.get("reportType")
        or "تقرير سردي تفصيلي، تم إعداد هذا التقرير بطريقة سردية مع مراعاة جميع التفاصيل المؤثرة في الأصل محل التقييم."
    )
    delivery_method = (
        tx.get("deliveryMethod")
        or "إخطار بريدي إلكتروني رسمي بالبيانات الموضحة في بيانات التواصل مع العميل."
    )
    currency = (
        tx.get("currency") or "إن التقييم والحسابات كافة تمت بالريال السعودي (د.ي)."
    )
    standards = tx.get("standards") or (
        "- تم تنفيذ جميع أعمال التقييم وفقًا لنظام الهيئة السعودية للمقيمين المعتمدين ولائحته التنفيذية، وقواعد سلوك مهنة التقييم وآدابها.\n"
        "- تم الالتزام بمعايير التقييم الدولية IVS التي نشرها مجلس معايير التقييم الدولية، والتي تشمل أحدث نسخة من معايير التقييم الدولية IVS وتعود للعام 2025 يناير 31."
    )
    independence_decl = ev.get("independenceDecl") or (
        "- نُقر بأننا (شركة تقدير للتقييم) لا يوجد لديها أي اهتمام خاص بالعقارات ولا يوجد تضارب في المصالح المحتملة مع الأطراف وأصحاب العقارات سواء في الوقت الحالي أو المستقبل.\n"
        "- أن جميع أعضاء فريق التقييم ملتزمون بمعايير النزاهة والمهنية وحفاظ الحفاظ على سرية المعلومات المتعلقة بالتقييم."
    )
    external_expert = ev.get("externalExpert") or (
        "لم يتم الاستعانة بأي أخصائي خارجي أثناء تنفيذ هذه المهمة. جميع إجراءات المعاينة، جمع البيانات، التحليلات واستخلاص القيمة تمت حصرًا بواسطة فريق التقييم "
        "وفقًا للسياسات والإجراءات المعتمدة، والالتزام بمعايير IVS مع الاعتماد على الداخلي لشركة تقدير للتقييم."
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
    <div style="margin-bottom: 8mm; position: relative; z-index: 2;">
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
    <div style="position: relative; z-index: 2;">
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
                <td class="c-table-narrative__value">{property_desc}</td>
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
