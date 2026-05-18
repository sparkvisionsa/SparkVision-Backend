from __future__ import annotations

"""
page6_research.py — نطاق البحث ومصادر معلومات المقيم

Dynamic fields
--------------
  tx.valuationPurpose  →  injected into row 2 of the reliability table
                          ("الغرض من التقييم: حسب إفادة العميل، الغرض … هو …")

Everything else is company / methodology boilerplate.
TODO: move all _CONST_* strings into a Company / report-config collection.
"""


# ── Section 1 — Opening paragraph ─────────────────────────────────────────────
# TODO: Company model — fixed methodology description
_INTRO = (
    "تمت معاينة العقار من قبل المعاينة الميدانية، ويتحدد البحث بالمدينة والحي الواقع فيه العقار "
    "المطلوب تقييمه في الاستخدام المذكور أعلاه، وتم جمع المعلومات عن الأراضي والمباني المقارنة "
    "وأخذ في الاعتبار المسح السوقي بمنطقة العقار وجمع المعلومات وتحليلها بما يتوافق مع أنواع "
    "العقار، واعتمدنا في تقريرنا هذا على العديد من المصادر من المعلومات الرسمية وغير الرسمية "
    "ومع المعلومات المستلمة من العميل والبيانات المفتوحة والتقارير المعلنة، مثل:"
)

# ── Section 1 — Bullet list ────────────────────────────────────────────────────
# TODO: Company model — fixed list of data sources used by this company
_SOURCES = [
    "نظام المقيمين المعتمدين الصادر بمرسوم ملكي رقم (م/43) هـ 09/07/1433",
    "معايير التقييم الدولية 2025",
    "أسعار المقاولين والمطورين السائدة بالسوق",
    "مؤشرات وزارة العدل",
    "المستندات المسلمة من العميل",
    "البيانات الجيومكانية الوطنية",
    "أمانات المدن والمحافظات",
    "التطبيقات والمنصات العقارية",
    "منصة بسيطة العقارية",
    "عقار ساس",
    "تطبيق عقار",
    "وزارة الاقتصاد والتخطيط",
    "الهيئة العامة للإحصاء",
    "البنك المركزي السعودي",
    "قاعدة بيانات شركة تقدير للتقييم",
]

# ── Section 1 — Closing paragraph ─────────────────────────────────────────────
# TODO: Company model — fixed closing note on source reliability
_OUTRO = (
    "وتم اختيار هذه المصادر لموثوقيتها ودقتها وتوافر المعلومات اللازمة حول الأصول محل التقييم، "
    "وتم استخدام هذه المصادر للوصول إلى رأي قيمة موثوقة ودقيقة."
)
_OUTRO2 = "التأكد من موثوقية المعلومات المقدمة ومصداقيتها."

# ── Section 2 — Reliability table rows (steps 1, 3, 4) ───────────────────────
# TODO: Company model — fixed process description rows
_ROW1_DESC = "إجراء بحث ميداني للتحقق من المعلومات السوقية المتعلقة بالعقارات."
_ROW1_RULING = (
    "استخدام مصادر متنوعة للحصول على معلومات دقيقة وحديثة، بما في ذلك مواقع حكومية "
    "مثل مؤشرات وزارة العدل والبورصة العقارية."
)

# Row 2 desc is partly dynamic (valuation purpose injected at render time)
_ROW2_RULING = (
    "- أهمية المعلومات: إعداد مسح ميداني وتقييم الموقع والملاءمة.<br>"
    "- خبرة المصدر: الاعتماد على مواقع حكومية موثوقة مثل مؤشرات وزارة العدل "
    "والبيانات المستخرجة من البورصة العقارية.<br>"
    "- استقلالية المصدر: الاعتماد على بيانات مستقلة من مصادر حكومية لضمان الشفافية."
)

_ROW3_DESC = "مقارنة المعلومات المقدمة من العميل مثل صك الملكية، رخصة البناء، الرفع المساحي وإن وجد."
_ROW3_RULING = (
    "- الاعتماد على مؤشرات وزارة العدل والبورصة العقارية للتحقق من دقة المعلومات.<br>"
    "- الاعتماد على البيانات المتاحة في البورصة العقارية للتحقق من دقة المعلومات.<br>"
    "- تم الاستعلام عن الصك في منصة البورصة العقارية والمخطط من U maps."
)

_ROW4_DESC = (
    "الاعتماد على بيانات عقارات مماثلة من نفس المنطقة الجغرافية، حيث تم اختيار العقارات "
    "التي تتشابه في الحجم والنوع والموقع مع الأصل محل التقييم."
)
_ROW4_RULING = (
    "- العقارات المقارنة تقع في المناطق المجاورة للعقار الأصلي وتم التحقق من ملاءمتها.<br>"
    "- العقارات المقارنة تقع في المناطق المجاورة للعقار الأصلي وتم التحقق من ملاءمتها."
)

# ── Cell style helpers ─────────────────────────────────────────────────────────
_TD_LABEL = (
    "border:1px solid var(--border-light);padding:3mm 4mm;"
    "color:var(--teal-primary);font-weight:600;"
    "vertical-align:top;text-align:right;width:24%;white-space:nowrap;"
)
_TD_BODY = (
    "border:1px solid var(--border-light);padding:3mm 4mm;"
    "background:var(--bg-table-cell);vertical-align:top;line-height:1.7;"
)


def render(data: dict) -> str:
    tx = data.get("tx", {})
    label_maps = data.get("labelMaps", {})

    # ── Only dynamic value on this page ───────────────────────────────────────
    valuation_purpose_id = tx.get("valuationPurpose", "")
    valuation_purpose = (
        label_maps.get("valuationPurposes", {}).get(valuation_purpose_id, "—")
        if valuation_purpose_id
        else "—"
    )

    # Row 2 description: fixed prefix + dynamic purpose label
    row2_desc = f"- الغرض من التقييم: حسب إفادة العميل، الغرض من التقييم هو {valuation_purpose}."

    # Build bullet list HTML
    bullets_html = "\n".join(
        f'<p class="c-text-body" style="margin-bottom:1.5mm;">- {src}</p>'
        for src in _SOURCES
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

    <!-- SECTION 1: نطاق البحث ومصادر معلومات المقيم -->
    <div style="margin-bottom:6mm;position:relative;z-index:2;">
        <div class="c-section-heading">نطاق البحث ومصادر معلومات المقيم</div>
    </div>

    <div style="position:relative;z-index:2;margin-bottom:4mm;">
        <p class="c-text-body">{_INTRO}</p>
    </div>

    <div style="position:relative;z-index:2;margin-bottom:5mm;padding-right:4mm;">
        {bullets_html}
    </div>

    <div style="position:relative;z-index:2;margin-bottom:6mm;">
        <p class="c-text-body">{_OUTRO}</p>
        <p class="c-text-body">{_OUTRO2}</p>
    </div>

    <!-- SECTION 2: reliability table -->
    <div style="position:relative;z-index:2;">
        <div class="c-section-heading" style="
            display:flex;justify-content:space-between;align-items:center;
            padding:2.5mm 4mm;border-radius:2mm 2mm 0 0;">
            <span style="flex:1;text-align:center;">الخطوة</span>
            <span style="width:1px;background:rgba(255,255,255,0.35);align-self:stretch;margin:0 3mm;"></span>
            <span style="flex:1;text-align:center;">الوصف</span>
            <span style="width:1px;background:rgba(255,255,255,0.35);align-self:stretch;margin:0 3mm;"></span>
            <span style="flex:1;text-align:center;">الحكم على موثوقية البيانات والمدخلات</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
            <tr>
                <td style="{_TD_LABEL}">1. جمع المعلومات</td>
                <td style="{_TD_BODY}width:38%;">{_ROW1_DESC}</td>
                <td style="{_TD_BODY}width:38%;">{_ROW1_RULING}</td>
            </tr>
            <tr>
                <td style="{_TD_LABEL}">2. تقييم مصداقية المعلومات</td>
                <td style="{_TD_BODY}">{row2_desc}</td>
                <td style="{_TD_BODY}">{_ROW2_RULING}</td>
            </tr>
            <tr>
                <td style="{_TD_LABEL}">3. التحقق من المعلومات</td>
                <td style="{_TD_BODY}">{_ROW3_DESC}</td>
                <td style="{_TD_BODY}">{_ROW3_RULING}</td>
            </tr>
            <tr>
                <td style="{_TD_LABEL}">4. مصادر العقارات المقارنة</td>
                <td style="{_TD_BODY}">{_ROW4_DESC}</td>
                <td style="{_TD_BODY}">{_ROW4_RULING}</td>
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
