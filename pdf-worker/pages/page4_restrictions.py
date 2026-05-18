from __future__ import annotations

"""
page4_restrictions.py — القيود والافتراضات والعوامل البيئية والمنهجية
"""


def render(data: dict) -> str:
    ev = data.get("ev", {})

    # ── Section 1 — Usage / publication restrictions ───────────────────────────
    # TODO: s1_p1 — company boilerplate, add to Company model or a report-config table
    s1_p1 = (
        "TODO: usage restriction text from Company model — "
        "هذا التقرير أُعد لأغراض التقييم وفقًا لمعايير التقييم الدولية، وتبقى جميع الحقوق "
        "محفوظة لشركة تقدير للتقييم، ولا يجوز نسخ أو إعادة إنتاج أو توزيع أو نشر "
        "هذا التقرير كليًا أو جزئيًا، بأي وسيلة ورقية أو إلكترونية."
    )

    # ── Section 2 — Disclaimer sub-items ─────────────────────────────────────
    # TODO: all five sub-items — company boilerplate, add to Company model
    s2_ownership = (
        "TODO: ownership disclaimer from Company model — "
        "هذه الوثيقة تُعد ملكًا لشركة تقدير للتقييم، ولا يجوز استخدامها لأغراض غير ما أُعدت له."
    )
    s2_fluctuation = (
        "TODO: fluctuation disclaimer from Company model — "
        "هامش التذبذب في القيمة يصل إلى ±10%، تبعًا لظروف السوق والأسعار الحالية."
    )
    s2_market = (
        "TODO: market study disclaimer from Company model — "
        "تم إجراء دراسة للسوق العقاري في منطقة العقار المستهدف باستخدام أقرب العقارات مقاربةً."
    )
    s2_update = (
        "TODO: data update disclaimer from Company model — "
        "قد تتغير النتائج في حال تم توفير بيانات جديدة تؤثر على القيمة."
    )
    s2_disclosure = (
        "TODO: disclosure statement from Company model — "
        "نؤكد أن التقرير يحتوي على معلومات صحيحة وفق معرفتنا."
    )

    # ── Section 3 — Assumptions ───────────────────────────────────────────────
    # ev.assumptions is the per-report user-entered assumption text
    # The opening definition paragraph is fixed IVS boilerplate → Company model
    s3_boilerplate = (
        "TODO: assumptions definition boilerplate from Company model — "
        "تُعد الافتراضات أمورًا منطقية يمكن قبولها كحقيقة في سياق أعمال التقييم دون التحقق "
        "والتدقيق فيها بصورة محددة (وفقًا لتعريف معايير التقييم الدولية)."
    )
    # ✅ Dynamic — per-report assumption text entered by the appraiser
    s3_assumption = ev.get("assumptions") or "—"

    # ── Section 4 — ESG factors ───────────────────────────────────────────────
    # TODO: ESG boilerplate — fixed company text, add to Company model
    s4_body = (
        "TODO: ESG boilerplate from Company model — "
        "تُقدم العوامل البيئية والاجتماعية والحوكمة إطارًا شاملًا لفهم التحديات والفرص التي "
        "تواجه عمليات التقييم. وتم افتراض أن هذه العوامل لا يوجد لها تأثيرات في عملية التقييم."
    )

    # ── Section 5 — Nature of appraiser work / restrictions ──────────────────
    # ✅ Dynamic — ev.risks holds per-report restrictions/limitations text
    s5_body = ev.get("risks") or "لا يوجد"

    # ── Section 6 — Quality assurance ────────────────────────────────────────
    # TODO: QA boilerplate — fixed company text, add to Company model
    s6_body = (
        "TODO: quality assurance text from Company model — "
        "تم توثيق مراحل التقييم ومراجعتها داخليًا وفق نظام ضمان الجودة المعتمد لدى الشركة، "
        "لضمان اتساق النتائج مع متطلبات (IVS 106) و(IVS 101)."
    )

    # ── Section 7 — IVS 100 framework items ──────────────────────────────────
    # TODO: all four items — fixed IVS boilerplate, add to Company model
    s7_integrity = (
        "TODO: integrity statement from Company model — "
        "تم تنفيذ جميع مراحل التقييم بموضوعية واستقلالية تامة دون أي تأثير من الأطراف ذات العلاقة."
    )
    s7_objectivity = (
        "TODO: objectivity statement from Company model — "
        "تم الاستناد إلى بيانات سوقية وتحليلية موثقة، مع التأكد من مصداقيتها من مصادر متعددة."
    )
    s7_competence = (
        "TODO: competence statement from Company model — "
        "أُنجز التقييم بواسطة فريق متخصص ومرخص من الهيئة السعودية للمقيمين المعتمدين."
    )
    s7_due_care = (
        "TODO: due care statement from Company model — "
        "تم تنفيذ التقييم وفق أفضل الممارسات المهنية وبمستوى مناسب من الفحص والتحقق."
    )

    # ── Final section — IVS 105 / IVS 106 compliance ─────────────────────────
    # TODO: compliance boilerplate — fixed company text, add to Company model
    s_final_body = (
        "TODO: IVS 105/106 compliance text from Company model — "
        "تم تطبيق هذا التقييم باستخدام نموذج تقييم مهني ملائم لطبيعة الأصل محل التقييم "
        "والغرض منه، وبما يتوافق مع متطلبات معيار (IVS 105 — نماذج التقييم)."
    )

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

    <!-- SECTION 1 — القيود على الاستخدام والنشر والتوزيع -->
    <div class="c-section-heading c-section-heading--pill" style="margin-bottom:4mm;">
        القيود على الاستخدام والنشر والتوزيع
    </div>
    <p class="c-text-body">{s1_p1}</p>

    <!-- SECTION 2 — إخلاء المسؤولية -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        إخلاء المسؤولية
    </div>
    <div style="display:flex;gap:6mm;direction:rtl;">
        <div style="flex:1;">
            <p class="c-text-primary" style="margin-bottom:2mm;">حقوق الملكية:</p>
            <p class="c-text-body">{s2_ownership}</p>
            <p class="c-text-primary" style="margin-bottom:2mm;">هامش التذبذب في القيمة:</p>
            <p class="c-text-body">{s2_fluctuation}</p>
            <p class="c-text-primary" style="margin-bottom:2mm;">دراسة السوق:</p>
            <p class="c-text-body">{s2_market}</p>
        </div>
        <div style="flex:1;">
            <p class="c-text-primary" style="margin-bottom:2mm;">تحديث المعلومات:</p>
            <p class="c-text-body">{s2_update}</p>
            <p class="c-text-primary" style="margin-bottom:2mm;">الإفصاح عن المعلومات:</p>
            <p class="c-text-body">{s2_disclosure}</p>
        </div>
    </div>

    <!-- SECTION 3 — الافتراضات والافتراضات الخاصة -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        الافتراضات والافتراضات الخاصة
    </div>
    <p class="c-text-body">{s3_boilerplate}</p>
    <p class="c-text-body">{s3_assumption}</p>

    <!-- SECTION 4 — العوامل البيئية والاجتماعية والحوكمة -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        العوامل البيئية والاجتماعية والحوكمة
    </div>
    <p class="c-text-body">{s4_body}</p>

    <!-- SECTION 5 — طبيعة عمل المقيم أو قيود عليه -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        طبيعة عمل المقيم أو قيود عليه
    </div>
    <p class="c-text-body">{s5_body}</p>

    <!-- SECTION 6 — جودة عملية التقييم -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        جودة عملية التقييم
    </div>
    <p class="c-text-body">{s6_body}</p>

    <!-- SECTION 7 — IVS 100 إطار التقييم -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        IVS 100 معيار إطار التقييم
    </div>
    <p class="c-text-body">
        يلتزم المقيم بالمعايير المهنية والأخلاقية الواردة في IVS 100 إطار التقييم، والتي تشمل ما يلي:
    </p>
    <p class="c-text-body"><span class="c-highlight">النزاهة: </span>{s7_integrity}</p>
    <p class="c-text-body"><span class="c-highlight">الموضوعية: </span>{s7_objectivity}</p>
    <p class="c-text-body"><span class="c-highlight">الكفاءة: </span>{s7_competence}</p>
    <p class="c-text-body"><span class="c-highlight">العناية المهنية الواجبة: </span>{s7_due_care}</p>

    <!-- FINAL SECTION — IVS 105 / IVS 106 -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top:5mm;margin-bottom:4mm;">
        الامتثال لمعيار (IVS 105) نماذج التقييم ومعيار (IVS 106) التوثيق وإعداد التقارير
    </div>
    <p class="c-text-body">{s_final_body}</p>

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
