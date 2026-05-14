def render(data: dict) -> str:
    """
    Page 4 — القيود والافتراضات والعوامل البيئية والمنهجية
    Simple header + paragraph layout using existing components only:
      - c-page-header (Component 1)
      - c-section-heading / c-section-heading--pill (Component 2)
      - c-text-body / c-text-primary / c-highlight (Component 4)
    Section 2 uses a two-column layout with teal sub-headers.
    Section 7 uses a numbered list styled with c-text-body.
    """
    ev = data.get("ev", {})

    # ── Section 1 ─────────────────────────────────────────────────────────────
    s1_p1 = ev.get(
        "s1P1",
        "هذا التقرير أُعد لأغراض التقييم وفقًا لمعايير التقييم الدولية، وتبقى جميع الحقوق "
        "محفوظة لشركة تقدير للتقييم، ولا يجوز نسخ أو إعادة إنتاج أو إنتاج أو توزيع أو نشر "
        "هذا التقرير كليًا أو جزئيًا، بأي وسيلة ورقية أو إلكترونية.",
    )

    s2_ownership = ev.get(
        "s2Ownership",
        "هذه الوثيقة تُعد ملكًا لشركة تقدير للتقييم، ولا يجوز استخدامها لأغراض غير ما أُعدت له.",
    )
    s2_fluctuation = ev.get(
        "s2Fluctuation",
        "هامش التذبذب في القيمة يصل إلى ±10%، تبعًا لظروف السوق والأسعار الحالية.",
    )
    s2_market = ev.get(
        "s2Market",
        "تم إجراء دراسة للسوق العقاري في منطقة العقار المستهدف باستخدام أقرب العقارات مقاربةً "
        "من حيث المواصفات والمساحات، مع الحرص على دقة المعلومات بقدر الإمكان.",
    )
    s2_update = ev.get(
        "s2Update",
        "قد تتغير النتائج في حال تم توفير بيانات جديدة تؤثر على القيمة أو تمكنّا من الحصول على بيانات موثوقة.",
    )
    s2_disclosure = ev.get(
        "s2Disclosure",
        "نؤكد أن التقرير يحتوي على معلومات صحيحة وفق معرفتنا، ولم يتم إخفاء أي معلومات مهمة "
        "قد تؤثر على القيمة الحالية أو المستقبلية للعقار.",
    )

    # ── Section 3 ─────────────────────────────────────────────────────────────
    s3_body = ev.get(
        "s3Body",
        "تُعد الافتراضات أمورًا منطقية يمكن قبولها كحقيقة في سياق أعمال التقييم دون التحقق "
        "والتدقيق فيها بصورة محددة، كما أنها أمور تُقبل بمجرد ذكرها وهذه الافتراضات "
        "ضرورية لفهم التقييم والمقدمة أو المنشورة (وفقًا لتعريف معايير التقييم الدولية — "
        "الافتراضات الخاصة هي افتراضات تختلف عن الحقائق الفعلية الموجودة في تاريخ التقييم، "
        "تلك التي لا يفترضها مشارك معتاد في السوق في معاملة ما في سياق التقييم المقدمة "
        "أو المنشورة وتاريخ التقييم).",
    )
    s3_assumption = ev.get(
        "s3Assumption",
        "وفي هذه المهمة التقييمية تم افتراض التالي:",
    )

    # ── Section 4 ─────────────────────────────────────────────────────────────
    s4_body = ev.get(
        "s4Body",
        "تُقدم العوامل البيئية والاجتماعية والحوكمة إطارًا شاملًا لفهم التحديات والفرص التي "
        "تواجه عمليات التقييم فيما يتعلق بالمجالات ذات الركائز الثلاث الأساسية، وهي: "
        "العوامل البيئية، العوامل الاجتماعية، كما يتضح تأثير هذه العوامل مجتمعةً على أداء "
        "السوق ونطاق أوسع يشمل المجتمع كله، وينعكس أيضًا على عمليات التقييم ابتداءً من "
        "تحديد مدى دقة البيانات والتحليلات إلى تأثير نتائج التقييم على صنع القرارات وسياسات "
        "الحوكمة والمجتمع. وتم افتراض أن هذه العوامل لا يوجد لها تأثيرات في عملية التقييم.",
    )

    # ── Section 5 ─────────────────────────────────────────────────────────────
    s5_body = ev.get("s5Body", "لا يوجد")

    # ── Section 6 ─────────────────────────────────────────────────────────────
    s6_body = ev.get(
        "s6Body",
        "تم توثيق مراحل التقييم ومراجعتها داخليًا وفق نظام ضمان الجودة المعتمد لدى الشركة، "
        "لضمان اتساق النتائق مع متطلبات (IVS 106) و(IVS 101).",
    )

    # ── Section 7 list items ──────────────────────────────────────────────────
    s7_integrity = ev.get(
        "s7Integrity",
        "تم تنفيذ جميع مراحل التقييم بموضوعية واستقلالية تامة دون أي تأثير من الأطراف ذات العلاقة.",
    )
    s7_objectivity = ev.get(
        "s7Objectivity",
        "تم الاستناد إلى بيانات سوقية وتحليلية موثقة، مع التأكد من مصداقيتها من مصادر متعددة.",
    )
    s7_competence = ev.get(
        "s7Competence",
        "أُنجز التقييم بواسطة فريق متخصص ومرخص من الهيئة السعودية للمقيمين المعتمدين، "
        "يتمتع بالخبرة الفنية في أنواع الأصل محل التقييم.",
    )
    s7_due_care = ev.get(
        "s7DueCare",
        "تم تنفيذ التقييم وفق أفضل الممارسات المهنية وبمستوى مناسب من الفحص والتحقق.",
    )

    # ── Final section ─────────────────────────────────────────────────────────
    s_final_body = ev.get(
        "sFinalBody",
        "تم تطبيق هذا التقييم باستخدام نموذج تقييم مهني ملائم لطبيعة الأصل محل التقييم "
        "والغرض منه، وبما يتوافق مع متطلبات معيار (IVS 105 — نماذج التقييم)، وقد تم "
        "اختيار النموذج المناسب استنادًا إلى توافر البيانات ومدى موثوقيتها واتساقها مع واقع "
        "السوق، بشكل يتيح للمستخدم التقييم فهم منهجية العمل وإعادة تتبع خطواته.",
    )

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

    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 1 — القيود على الاستخدام والنشر والتوزيع
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-bottom: 4mm;">
        القيود على الاستخدام والنشر والتوزيع
    </div>
    <p class="c-text-body">هذا التقرير أُعد لأغراض التقييم وفقًا لمعايير التقييم الدولية، وتبقى جميع الحقوق محفوظة لشركة تقدير للتقييم. ولا يجوز نسخ أو إعادة إنتاج أو توزيع أو نشر هذا التقرير، كليًا أو جزئيًا، بأي وسيلة ورقية أو إلكترونية أو أي وسيلة أخرى، إلا بعد الحصول على موافقة خطية مسبقة من شركة تقدير للتقييم. كما يقتصر استخدام التقرير على الأطراف المصرح لهم، ولا يجوز توظيفه في أي أغراض أخرى.
</p>

    <!-- ══════════════════════════════════════════════════════════════════════
             SECTION 2 — إخلاء المسؤولية  (two-column, teal sub-headers)
             ══════════════════════════════════════════════════════════════════════ -->
        <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
            إخلاء المسؤولية
        </div>
        <div style="display: flex; gap: 6mm; direction: rtl;">
            <!-- Right column -->
            <div style="flex: 1;">
                <p class="c-text-primary" style="margin-bottom: 2mm;">حقوق الملكية:</p>
                <p class="c-text-body">{s2_ownership}</p>
                <p class="c-text-primary" style="margin-bottom: 2mm;">هامش التذبذب في القيمة:</p>
                <p class="c-text-body">{s2_fluctuation}</p>
                <p class="c-text-primary" style="margin-bottom: 2mm;">دراسة السوق:</p>
                <p class="c-text-body">{s2_market}</p>
            </div>
            <!-- Left column -->
            <div style="flex: 1;">
                <p class="c-text-primary" style="margin-bottom: 2mm;">تحديث المعلومات:</p>
                <p class="c-text-body">{s2_update}</p>
                <p class="c-text-primary" style="margin-bottom: 2mm;">الإفصاح عن المعلومات:</p>
                <p class="c-text-body">{s2_disclosure}</p>
            </div>
        </div>


    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 3 — الافتراضات والافتراضات الخاصة (وجدت)
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
        الافتراضات والافتراضات الخاصة (وجدت)
    </div>
    <p class="c-text-body">{s3_body}</p>
    <p class="c-text-body">{s3_assumption}</p>

    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 4 — العوامل البيئية والاجتماعية والحوكمة
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
        العوامل البيئية والاجتماعية والحوكمة
    </div>
    <p class="c-text-body">{s4_body}</p>

    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 5 — طبيعة عمل المقيم أو قيود عليه
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
        طبيعة عمل المقيم أو قيود عليه
    </div>
    <p class="c-text-body">{s5_body}</p>

    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 6 — جودة عملية التقييم
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
        جودة عملية التقييم
    </div>
    <p class="c-text-body">{s6_body}</p>

    <!-- ══════════════════════════════════════════════════════════════════════
         SECTION 7 — معيار IVS 100 إطار التقييم  (numbered list)
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
        IVS 100 معيار إطار التقييم
    </div>
    <p class="c-text-body">
        يلتزم المقيم بالمعايير المهنية والأخلاقية الواردة في IVS 100 إطار التقييم، والتي تشمل ما يلي:
    </p>
    <p class="c-text-body">
        <span class="c-highlight">النزاهة: </span>{s7_integrity}
    </p>
    <p class="c-text-body">
        <span class="c-highlight">الموضوعية: </span>{s7_objectivity}
    </p>
    <p class="c-text-body">
        <span class="c-highlight">الكفاءة: </span>{s7_competence}
    </p>
    <p class="c-text-body">
        <span class="c-highlight">العناية المهنية الواجبة: </span>{s7_due_care}
    </p>

    <!-- ══════════════════════════════════════════════════════════════════════
         FINAL SECTION — الامتثال لمعيار (IVS 105) ومعيار (IVS 106)
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="c-section-heading c-section-heading--pill" style="margin-top: 5mm; margin-bottom: 4mm;">
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
