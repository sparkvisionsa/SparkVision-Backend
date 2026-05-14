def render(data: dict) -> str:
    """
    Page 4 — جدول التسلسل الهرمي
    Renders a three-level fair-value hierarchy table using the reusable
    .c-table-kv component (Component 6 in components.css).

    Each level is composed of alternating key/value row pairs:
        - .c-table-kv__level  → dark teal level banner
        - .c-table-kv__key    → column headings (teal tint)
        - .c-table-kv__val    → actual content rows (faint bg)

    The five columns are:
        التوضيح | بيان المدخلات | التصنيف | المصدر | الحكم والتوثيق
    """
    ev = data.get("ev", {})

    # ── Level 1 content ───────────────────────────────────────────────────────
    l1_clarification = ev.get(
        "l1Clarification",
        "هي الأسعار المعلنة (غير المعدلة) في أسواق نشطة لأصول أو الالتزامات المطابقة "
        "للوصول إليها في تاريخ القياس وستعطى الأولوية.",
    )
    l1_inputs = ev.get(
        "l1Inputs",
        "لا توجد أسعار معلنة مطابقة للأصل محل التقييم في سوق نشط.",
    )
    l1_classification = ev.get("l1Classification", "لا ينطبق")
    l1_source = ev.get("l1Source", "لا ينطبق")
    l1_ruling = ev.get(
        "l1Ruling",
        "لا توجد أسواق نشطة لأصول من هذا النوع، وبالتالي لم تُستخدم مدخلات مستوى أول.",
    )

    # ── Level 2 content ───────────────────────────────────────────────────────
    l2_clarification = ev.get(
        "l2Clarification",
        "هي المدخلات خلاف الأسعار المعلنة الواقعة ضمن المستوى الأول والتي يمكن رصدها "
        "بشكل مباشر أو غير مباشر.",
    )
    l2_inputs = ev.get(
        "l2Inputs",
        "أسعار صفقات وعمليات بيع مماثلة لعقارات تجارية في منطقة العقار، "
        "معدلات إيجارية تجارية منشورة، عروض أسعار من مقاولين لتكلفة الإحلال.",
    )
    l2_classification = ev.get("l2Classification", "مدخلات قابلة للملاحظة")
    l2_source = ev.get(
        "l2Source",
        "بيانات السوق – وزارة العدل – تطبيقات السوق العقاري – عروض أسعار المقاولين",
    )
    l2_ruling = ev.get(
        "l2Ruling",
        "موثوقة بعد التحقق من ملاءمتها ومقارنتها ببيانات سوقية مشابهة وتحليل اتجاهات الأسعار.",
    )

    # ── Level 3 content ───────────────────────────────────────────────────────
    l3_clarification = ev.get(
        "l3Clarification",
        "هي المدخلات التي لا يمكن رصدها وتُعطى الأولوية الأدنى.",
    )
    l3_inputs = ev.get("l3Inputs", "لا ينطبق")
    l3_classification = ev.get("l3Classification", "مدخلات غير قابلة للملاحظة")
    l3_source = ev.get("l3Source", "لا ينطبق")
    l3_ruling = ev.get("l3Ruling", "لا ينطبق")

    return f"""
<div class="page statement-page">

    <!-- WATERMARK -->
    <div class="statement-watermark">تقدير</div>

    <!-- PAGE LOGO HEADER (Component 1) -->
    <div class="c-page-header">
        <div class="c-page-header__logo">
            <div class="c-page-header__mark"></div>
            <div class="c-page-header__text">
                <div class="c-page-header__ar">تقدير</div>
                <div class="c-page-header__en">Taqdeer</div>
            </div>
        </div>
    </div>

    <!-- PAGE SECTION HEADING (Component 2) -->
    <div class="c-section-heading c-section-heading--pill" style="margin-bottom: 6mm;">
        جدول التسلسل الهرمي
    </div>

    <!-- COMPONENT 6: HIERARCHICAL KEY-VALUE TABLE -->
    <table class="c-table-kv">

        <!-- ════════════════════════════════════════════════════════════════
             LEVEL 1 — الأول
             ════════════════════════════════════════════════════════════════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الأول (Level 1)</td>
        </tr>

        <!-- Key row -->
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <!-- Value row -->
        <tr class="c-table-kv__val">
            <td>{l1_clarification}</td>
            <td>{l1_inputs}</td>
            <td>{l1_classification}</td>
            <td>{l1_source}</td>
            <td>{l1_ruling}</td>
        </tr>

        <!-- ════════════════════════════════════════════════════════════════
             LEVEL 2 — الثاني
             ════════════════════════════════════════════════════════════════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الثاني (Level 2)</td>
        </tr>

        <!-- Key row -->
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <!-- Value row -->
        <tr class="c-table-kv__val">
            <td>{l2_clarification}</td>
            <td>{l2_inputs}</td>
            <td>{l2_classification}</td>
            <td>{l2_source}</td>
            <td>{l2_ruling}</td>
        </tr>

        <!-- ════════════════════════════════════════════════════════════════
             LEVEL 3 — الثالث
             ════════════════════════════════════════════════════════════════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الثالث (Level 3)</td>
        </tr>

        <!-- Key row -->
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <!-- Value row -->
        <tr class="c-table-kv__val">
            <td>{l3_clarification}</td>
            <td>{l3_inputs}</td>
            <td>{l3_classification}</td>
            <td>{l3_source}</td>
            <td>{l3_ruling}</td>
        </tr>

    </table>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">4</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
