from __future__ import annotations

"""
page12_methodology.py — أسلوب/طريقة التقييم المستخدمة

Dynamic fields
--------------
  Which approaches are USED is derived from whether the corresponding
  totals are filled in ev — no separate boolean flags needed:
    ev.marketMethodTotal  → non-empty  ⟹  أسلوب السوق  used
    ev.incomeTotal        → non-empty  ⟹  أسلوب الدخل  used
    ev.costLandBuildTotal → non-empty  ⟹  أسلوب التكلفة used

  ev.scope  →  justification paragraph (appraiser fills this in)

Section 3 grid is fixed IVS methodology boilerplate.
TODO: move all grid cell text to Company / report-config model.
"""


def _cb(checked: bool) -> str:
    return "☑" if checked else "☐"


# ── Section 3 grid — fixed boilerplate ────────────────────────────────────────
# TODO: Company/report-config model

_MARKET_DESC = (
    "تستند هذه الطريقة إلى مقارنة العقار المراد تقييمه مع عقارات مشابهة تم بيعها مؤخرًا "
    "في نفس المنطقة أو مناطق مشابهة. يتم استخدام معلومات عن صفقات البيع الفعلية لتحديد قيمة العقار."
)
_MARKET_MECH = (
    "جمع بيانات مبيعات العقارات المشابهة.<br>"
    "تعديل الأسعار استنادًا إلى الفروقات بين العقارات.<br>"
    "تحليل الصفات المميزة لكل عقار مثل المساحة والموقع وحالة العقار وتجهيزاته.<br>"
    "توفير تقدير موضوعي يستند إلى السوق الفعلي وليس على التقديرات النظرية."
)
_MARKET_REASONS = (
    "دقة نسبية في تحديد القيمة العادلة للعقار في ظل وجود معاملات مماثلة حديثة.<br>"
    "توفر بيانات مبيعات مشابهة وسهولة الوصول إليها."
)
_MARKET_NOTES = (
    "يمكن أن تكون هناك تحديات في حالات السوق غير المستقر أو في المناطق التي تشهد قلة في المعاملات.<br>"
    "يجب أن تكون المقارنات دقيقة لضمان صحة التقييم مع مراعاة كافة الفروقات.<br>"
    "يعتمد نجاح هذه الطريقة على توفر بيانات مبيعات دقيقة وحديثة."
)

_COST_DESC = (
    "تتمثل هذه الطريقة في تقدير تكلفة بناء عقار جديد بنفس مواصفات العقار المراد تقييمه، "
    "ثم يتم تعديل هذه التكلفة حسب حالة العقار (الإهلاك) للحصول على القيمة الحالية."
)
_COST_MECH = (
    "جمع تكلفة الأرض وتكلفة البناء المعدّلة لتحديد القيمة الإجمالية.<br>"
    "احتساب الإهلاك (مادي + وظيفي + اقتصادي).<br>"
    "تقدير تكلفة الأرض.<br>"
    "يعطي فكرة عن تكلفة استبدال العقار بنفس الجودة والمواصفات."
)
_COST_REASONS = (
    "مناسب للعقارات التي يصعب إيجاد معاملات مقارنة لها.<br>"
    "مفيد لتقييم العقارات الجديدة أو الحديثة البناء."
)
_COST_NOTES = (
    "قد يكون غير مناسب للعقارات القديمة جدًا بسبب صعوبة تقدير الإهلاك بدقة.<br>"
    "يمكن أن يكون أقل دقة في الأسواق ذات التغيرات السريعة في الأسعار.<br>"
    "يتطلب تقديرات دقيقة لتكاليف البناء والإهلاك."
)

_INCOME_DESC = (
    "يستخدم هذا الأسلوب لتحويل صافي دخل العقار المتوقع إلى قيمة حالية باستخدام معدل رسملة مناسب. "
    "يُعتبر مناسبًا للعقارات التجارية التي تدر دخلًا ثابتًا."
)
_INCOME_MECH = (
    "تحديد صافي الدخل التشغيلي (NOI) للعقار.<br>"
    "تحديد معدل الرسملة المناسب استنادًا إلى ظروف السوق (Cap Rate).<br>"
    "معادلة الرسملة: قيمة العقار = صافي الدخل التشغيلي ÷ معدل الرسملة.<br>"
    "بسيط وسهل التطبيق مما يجعله شائع الاستخدام في تقييم العقارات التجارية."
)
_INCOME_REASONS = (
    "يتطلب تقديرًا دقيقًا لصافي الدخل التشغيلي ومعدل الرسملة.<br>"
    "يمكن أن يكون غير دقيق إذا كانت هناك تقلبات كبيرة في دخل العقار."
)
_INCOME_NOTES = "—"

# ── Cell style constants ───────────────────────────────────────────────────────
_TD_NAME_USED = (
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "color:var(--teal-primary);font-weight:700;"
    "vertical-align:top;text-align:right;width:14%;"
    "background:rgba(15,139,148,0.06);"
)
_TD_NAME_UNUSED = (
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "color:var(--text-muted);font-weight:700;"
    "vertical-align:top;text-align:right;width:14%;"
    "background:rgba(0,0,0,0.02);"
)
_TD_BODY = (
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "background:var(--bg-table-cell);vertical-align:top;"
    "line-height:1.6;text-align:right;"
)
_TD_BODY_MUTED = (
    "border:1px solid var(--border-light);padding:2.5mm 3mm;"
    "background:var(--bg-table-cell);vertical-align:top;"
    "line-height:1.6;text-align:right;color:var(--text-muted);"
)


def _method_row(
    name_ar: str,
    sub_ar: str,
    role: str,
    used: bool,
    desc: str,
    mech: str,
    reasons: str,
    notes: str,
) -> str:
    name_td = _TD_NAME_USED if used else _TD_NAME_UNUSED
    body_td = _TD_BODY if used else _TD_BODY_MUTED
    role_txt = role if used else "لم يُستخدم"
    return (
        f"<tr>"
        f'<td style="{name_td}">{name_ar}<br>'
        f'<span style="font-weight:400;color:var(--teal-dark);font-size:8pt;">'
        f"{sub_ar}<br>- {role_txt}</span></td>"
        f'<td style="{body_td}width:18%;">{desc}</td>'
        f'<td style="{body_td}width:22%;">{mech}</td>'
        f'<td style="{body_td}width:22%;">{reasons}</td>'
        f'<td style="{body_td}width:24%;">{notes}</td>'
        f"</tr>"
    )


def render(data: dict) -> str:
    ev = data.get("ev", {})

    # ── Derive which methods are used from non-empty totals ────────────────────
    used_market = bool(ev.get("marketMethodTotal", "").strip())
    used_income = bool(ev.get("incomeTotal", "").strip())
    used_cost = bool(ev.get("costLandBuildTotal", "").strip())

    # ── Justification paragraph ────────────────────────────────────────────────
    # ✅ ev.scope — appraiser-entered justification / scope text
    justification = ev.get("scope") or (
        "TODO: justification text from ev.scope — "
        "تم استخدام أسلوب السوق لتقدير قيمة الأرض وأسلوب التكلفة لتقدير قيمة المباني."
    )

    market_row = _method_row(
        "أسلوب السوق",
        "طريقة المقارنة",
        "مساعد",
        used_market,
        _MARKET_DESC,
        _MARKET_MECH,
        _MARKET_REASONS,
        _MARKET_NOTES,
    )
    cost_row = _method_row(
        "أسلوب التكلفة",
        "طريقة الإحلال",
        "أساسي",
        used_cost,
        _COST_DESC,
        _COST_MECH,
        _COST_REASONS,
        _COST_NOTES,
    )
    income_row = _method_row(
        "أسلوب الدخل",
        "طريقة رسملة الدخل",
        "مساعد",
        used_income,
        _INCOME_DESC,
        _INCOME_MECH,
        _INCOME_REASONS,
        _INCOME_NOTES,
    )

    return f"""
<div class="page statement-page">

    <div class="statement-watermark">تقدير</div>

    <div class="c-page-header">
        <div class="c-page-header__logo">
            <div class="c-page-header__mark"></div>
            <div class="c-page-header__text">
                <div class="c-page-header__ar">تقدير</div>
                <div class="c-page-header__en">Taqdeer</div>
            </div>
        </div>
    </div>

    <!-- SECTION 1: checkboxes -->
    <div style="margin-bottom:5mm;position:relative;z-index:2;">
        <div class="c-section-heading">أسلوب/طريقة التقييم المستخدمة</div>
        <table class="c-checkbox-table">
            <tr>
                <td>{_cb(used_market)} أسلوب السوق</td>
                <td>{_cb(used_income)} أسلوب الدخل</td>
                <td>{_cb(used_cost)}   أسلوب التكلفة</td>
            </tr>
            <tr>
                <td>طريقة المقارنة</td>
                <td>طريقة رسملة الدخل</td>
                <td>طريقة الإحلال</td>
            </tr>
        </table>
    </div>

    <!-- SECTION 2: justification -->
    <div style="margin-bottom:5mm;position:relative;z-index:2;">
        <div class="c-section-heading c-section-heading--pill" style="margin-bottom:3mm;">مبررات التقييم</div>
        <p class="c-text-body" style="margin-bottom:0;">{justification}</p>
    </div>

    <!-- SECTION 3: method grid -->
    <div style="position:relative;z-index:2;">
        <div class="c-section-heading" style="
            display:flex;justify-content:space-between;align-items:center;
            padding:2.5mm 4mm;border-radius:2mm 2mm 0 0;gap:0;">
            <span style="flex:1.4;text-align:center;">الأسلوب/الطريقة</span>
            <span style="width:1px;background:rgba(255,255,255,0.3);align-self:stretch;margin:0 2mm;"></span>
            <span style="flex:1.6;text-align:center;">الوصف</span>
            <span style="width:1px;background:rgba(255,255,255,0.3);align-self:stretch;margin:0 2mm;"></span>
            <span style="flex:2;text-align:center;">آلية عمل الطريقة</span>
            <span style="width:1px;background:rgba(255,255,255,0.3);align-self:stretch;margin:0 2mm;"></span>
            <span style="flex:1.6;text-align:center;">أسباب الاستخدام</span>
            <span style="width:1px;background:rgba(255,255,255,0.3);align-self:stretch;margin:0 2mm;"></span>
            <span style="flex:1.4;text-align:center;">الملاحظات</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt;direction:rtl;">
            {market_row}
            {cost_row}
            {income_row}
        </table>
    </div>

    <div class="statement-footer">
        <div class="footer-ribbon"><div class="footer-page">12</div></div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
