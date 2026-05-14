"""
page6_research.py — نطاق البحث ومصادر معلومات المقيم

Components used
---------------
  .c-page-header          →  logo header
  .c-section-heading      →  teal section bar
  .c-text-body            →  body paragraphs
  .c-table-narrative      →  section 2 complex table (repurposed with 3-col header)
"""


def render(data: dict) -> str:
    tx = data.get("tx", {})
    ev = data.get("ev", {})

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

    <!-- ── SECTION 1: نطاق البحث ومصادر معلومات المقيم ─────────── -->
    <div style="margin-bottom: 6mm; position: relative; z-index: 2;">
        <div class="c-section-heading">نطاق البحث ومصادر معلومات المقيم</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 4mm;">
        <p class="c-text-body">
            تمت معاينة العقار من قبل المعاينة الميدانية، ويتحدد البحث بالمدينة والحي الواقع فيه العقار المطلوب تقييمه
            في الاستخدام المذكور أعلاه، وتم جمع المعلومات عن الأراضي والمباني المقارنة وأخذ في
            الاعتبار المسح السوقي بمنطقة العقار وجمع المعلومات وتحليلها بما يتوافق مع أنواع العقار،
            واعتمدنا في تقريرنا هذا على العديد من المصادر من المعلومات الرسمية وغير الرسمية ومع المعلومات
            المستلمة من العميل والبيانات المفتوحة والتقارير المعلنة، مثل:
        </p>
    </div>

    <!-- Bulleted list -->
    <div style="position: relative; z-index: 2; margin-bottom: 5mm; padding-right: 4mm;">
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- نظام المقيمين المعتمدين الصادر بمرسوم ملكي رقم (م/43) هـ 09/07/1433</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- معايير التقييم الدولية 2025</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- أسعار المقاولين والمطورين السائدة بالسوق</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- مؤشرات وزارة العدل</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- المستندات المسلمة من العميل</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- البيانات الجيومكانية الوطنية</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- أمانات المدن والمحافظات</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- التطبيقات والمنصات العقارية</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- منصة بسيطة العقارية</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- عقار ساس</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- تطبيق عقار</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- وزارة الاقتصاد والتخطيط</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- الهيئة العامة للإحصاء</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- البنك المركزي السعودي</p>
        <p class="c-text-body" style="margin-bottom: 1.5mm;">- قاعدة بيانات شركة تقدير للتقييم</p>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 6mm;">
        <p class="c-text-body">
            وتم اختيار هذه المصادر لموثوقيتها ودقتها وتوافر المعلومات اللازمة حول الأصول محل التقييم،
            وتم استخدام هذه المصادر للوصول إلى رأي قيمة موثوقة ودقيقة.
        </p>
        <p class="c-text-body">
            التأكد من موثوقية المعلومات المقدمة ومصداقيتها.
        </p>
    </div>

    <!-- ── SECTION 2: complex 3-column header table (flipped horizontally) ──────────────── -->
    <div style="position: relative; z-index: 2;">

        <!-- Custom 3-part section heading — flipped order -->
        <div class="c-section-heading" style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2.5mm 4mm;
            border-radius: 2mm 2mm 0 0;
        ">
            <span style="flex: 1; text-align: center;">الخطوة</span>
            <span style="width: 1px; background: rgba(255,255,255,0.35); align-self: stretch; margin: 0 3mm;"></span>
            <span style="flex: 1; text-align: center;">الوصف</span>
            <span style="width: 1px; background: rgba(255,255,255,0.35); align-self: stretch; margin: 0 3mm;"></span>
            <span style="flex: 1; text-align: center;">الحكم على موثوقية البيانات والمدخلات</span>
        </div>

        <!-- Table body -->
        <table style="
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
        ">
            <!-- Row 1 (flipped) -->
            <tr>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; color: var(--teal-primary); font-weight: 600; vertical-align: top; text-align: right; width: 24%; white-space: nowrap;">
                    1. جمع المعلومات
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7; width: 38%;">
                    إجراء بحث ميداني للتحقق من المعلومات السوقية المتعلقة بالعقارات.
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7; width: 38%;">
                    - استخدام مصادر متنوعة للحصول على معلومات دقيقة وحديثة، بما في ذلك مواقع حكومية مثل
                    مؤشرات وزارة العدل والبورصة العقارية.<br>
                </td>
            </tr>

            <!-- Row 2 (flipped) -->
            <tr>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; color: var(--teal-primary); font-weight: 600; vertical-align: top; text-align: right; white-space: nowrap;">
                    2. تقييم مصداقية المعلومات
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    تقييم مصداقية المعلومات
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    - الغرض من التقييم: حسب إفادة العميل، الغرض من التقييم هو أغراض محاسبية.<br>
                    - أهمية المعلومات: إعداد مسح ميداني وتقييم الموقع والملاءمة.<br>
                    - خبرة المصدر: الاعتماد على مواقع حكومية موثوقة مثل مؤشرات وزارة العدل
                    والبيانات المستخرجة من البورصة العقارية.<br>
                    - استقلالية المصدر: الاعتماد على بيانات مستقلة من مصادر حكومية لضمان الشفافية.
                </td>
            </tr>

            <!-- Row 3 (flipped) -->
            <tr>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; color: var(--teal-primary); font-weight: 600; vertical-align: top; text-align: right; white-space: nowrap;">
                    3. التحقق من المعلومات
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    - مقارنة المعلومات المقدمة من العميل مثل صك الملكية، رخصة البناء، الرفع المساحي وإن وجد.
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    - الاعتماد على مؤشرات وزارة العدل والبورصة العقارية للتحقق من دقة المعلومات.<br>
                    - الاعتماد على البيانات المتاحة في البورصة العقارية للتحقق من دقة المعلومات.<br>
                    - تم الاستعلام عن الصك في منصة البورصة العقارية والمخطط من U maps.
                </td>
            </tr>

            <!-- Row 4 (flipped) -->
            <tr>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; color: var(--teal-primary); font-weight: 600; vertical-align: top; text-align: right; white-space: nowrap;">
                    4. مصادر العقارات المقارنة
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    - الاعتماد على بيانات عقارات مماثلة من نفس المنطقة الجغرافية، حيث تم اختيار العقارات
                    التي تتشابه في الحجم والنوع والموقع مع الأصل محل التقييم.
                </td>
                <td style="border: 1px solid var(--border-light); padding: 3mm 4mm; background: var(--bg-table-cell); vertical-align: top; line-height: 1.7;">
                    - العقارات المقارنة تقع في المناطق المجاورة للعقار الأصلي وتم التحقق من ملاءمتها.<br>
                    - العقارات المقارنة تقع في المناطق المجاورة للعقار الأصلي وتم التحقق من ملاءمتها.
                </td>
            </tr>
        </table>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">6</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
