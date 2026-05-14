def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})

    client_name = (
        ev.get("clientName")
        or "شركة نجوم السلام للاستثمار والتطوير العقاري (شركة شخص واحد ذ.م.م)"
    )
    final_value = ev.get("finalAssetValue") or "17,769,600.00"
    final_value_txt = (
        ev.get("finalAssetValueText")
        or "سبعة عشر مليون وسبعمائة وتسعة وستون ألفًا وستمائة ريال سعودي فقط لا غير"
    )
    eval_date = ev.get("evalDate") or "15-12-2025"
    appraiser_name = ev.get("appraiserName") or "حمد بن عبدالله بن ناصر الحمد"
    membership_no = ev.get("membershipNo") or "1210000414"
    membership_cat = ev.get("membershipCategory") or "اساسي زميل/فرع العقار"
    appraiser_title = ev.get("appraiserTitle") or "الرئيس التنفيذي"

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

    <!-- INTRO: c-text-primary + c-text-body -->
    <div class="statement-intro">
        <p class="c-text-primary">
            بناءً على طلب العميل / <span class="c-highlight">{client_name}</span>
            ذات الأنشطة العقارية، بتقييم (مجمع تجاري) بمدينة الزلفي، حي الزلفي، ملكية (الملكية المطلقة).
        </p>
        <p class="c-text-body">
            وبناءً على الترخيص الممنوح لنا من قبل الهيئة السعودية للمقيمين المعتمدين،
            واتباعًا لمعايير التقييم الدولية IVS السارية حتى 31 يناير 2025، وبناءً على
            الكشف الفعلي على موقع العقار ومعاينته ميدانيًا، ووفقًا لأخلاقيات المهنة
            والقواعد المتعارف عليها، وللوصول إلى التقييم النهائي الحيادي، وبعد إجراء
            دراسة للمنطقة المحيطة بالعقار والمستندات والعقود اللازمة، تم التوصل إلى
            (القيمة العادلة) باستخدام:
        </p>
    </div>

    <!-- COMPONENT 2 + 3: SECTION HEADING + CHECKBOX TABLE -->
    <div class="c-checkbox-block">
        <div class="c-section-heading">أسلوب أو فرضية القيمة المستخدمة</div>
        <table class="c-checkbox-table">
            <tr>
                <td>☑ قيمة سوقية</td>
                <td>☐ قيمة استثمارية</td>
                <td>☐ قيمة عادلة</td>
            </tr>
            <tr>
                <td>☐ استخدام حالي</td>
                <td>☑ الاستخدام الأعلى والأفضل</td>
                <td>☐ قيمة خاصة</td>
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

    <!-- COMPONENT 5: COMPACT TABLE — appraiser details -->
    <div style="margin-top: 10mm; position: relative; z-index: 2;">
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
