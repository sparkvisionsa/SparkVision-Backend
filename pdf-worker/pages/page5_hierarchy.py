from __future__ import annotations

"""
page5_hierarchy.py — جدول التسلسل الهرمي

All 15 cell values in this table are fixed IVS fair-value hierarchy
boilerplate. None of them vary per transaction or per property — they
describe the IVS Level 1 / 2 / 3 input framework itself, not the
specific asset being valued.

TODO: move all cell content into a Company / report-config collection
so they can be edited by the company admin without a code deployment.
Until then they are hardcoded here as named constants so the intent
is clear.
"""


# ── Level 1 — Observable quoted prices in active markets ──────────────────────
# TODO: store in Company/report-config model — IVS boilerplate, never per-report
_L1_CLARIFICATION = (
    "هي الأسعار المعلنة (غير المعدلة) في أسواق نشطة لأصول أو الالتزامات المطابقة "
    "للوصول إليها في تاريخ القياس وستعطى الأولوية."
)
_L1_INPUTS = "لا توجد أسعار معلنة مطابقة للأصل محل التقييم في سوق نشط."
_L1_CLASSIFICATION = "لا ينطبق"
_L1_SOURCE = "لا ينطبق"
_L1_RULING = (
    "لا توجد أسواق نشطة لأصول من هذا النوع، وبالتالي لم تُستخدم مدخلات مستوى أول."
)

# ── Level 2 — Observable inputs other than quoted prices ─────────────────────
# TODO: store in Company/report-config model — IVS boilerplate, never per-report
_L2_CLARIFICATION = (
    "هي المدخلات خلاف الأسعار المعلنة الواقعة ضمن المستوى الأول والتي يمكن رصدها "
    "بشكل مباشر أو غير مباشر."
)
_L2_INPUTS = (
    "أسعار صفقات وعمليات بيع مماثلة لعقارات تجارية في منطقة العقار، "
    "معدلات إيجارية تجارية منشورة، عروض أسعار من مقاولين لتكلفة الإحلال."
)
_L2_CLASSIFICATION = "مدخلات قابلة للملاحظة"
_L2_SOURCE = "بيانات السوق – وزارة العدل – تطبيقات السوق العقاري – عروض أسعار المقاولين"
_L2_RULING = "موثوقة بعد التحقق من ملاءمتها ومقارنتها ببيانات سوقية مشابهة وتحليل اتجاهات الأسعار."

# ── Level 3 — Unobservable inputs ────────────────────────────────────────────
# TODO: store in Company/report-config model — IVS boilerplate, never per-report
_L3_CLARIFICATION = "هي المدخلات التي لا يمكن رصدها وتُعطى الأولوية الأدنى."
_L3_INPUTS = "لا ينطبق"
_L3_CLASSIFICATION = "مدخلات غير قابلة للملاحظة"
_L3_SOURCE = "لا ينطبق"
_L3_RULING = "لا ينطبق"


def render(data: dict) -> str:
    # No fields pulled from data — this page is pure methodology boilerplate.
    # When the Company model is integrated, replace the constants above with
    # lookups like: company.get("hierarchyL1Clarification") or _L1_CLARIFICATION
    _ = data  # unused — kept for consistent render(data) signature

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

    <!-- SECTION HEADING -->
    <div class="c-section-heading c-section-heading--pill" style="margin-bottom:6mm;">
        جدول التسلسل الهرمي
    </div>

    <!-- COMPONENT 6: HIERARCHICAL KEY-VALUE TABLE -->
    <table class="c-table-kv">

        <!-- ════ LEVEL 1 ════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الأول (Level 1)</td>
        </tr>
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <tr class="c-table-kv__val">
            <td>{_L1_CLARIFICATION}</td>
            <td>{_L1_INPUTS}</td>
            <td>{_L1_CLASSIFICATION}</td>
            <td>{_L1_SOURCE}</td>
            <td>{_L1_RULING}</td>
        </tr>

        <!-- ════ LEVEL 2 ════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الثاني (Level 2)</td>
        </tr>
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <tr class="c-table-kv__val">
            <td>{_L2_CLARIFICATION}</td>
            <td>{_L2_INPUTS}</td>
            <td>{_L2_CLASSIFICATION}</td>
            <td>{_L2_SOURCE}</td>
            <td>{_L2_RULING}</td>
        </tr>

        <!-- ════ LEVEL 3 ════ -->
        <tr class="c-table-kv__level">
            <td colspan="5">الثالث (Level 3)</td>
        </tr>
        <tr class="c-table-kv__key">
            <td>التوضيح</td>
            <td>بيان المدخلات</td>
            <td>التصنيف</td>
            <td>المصدر</td>
            <td>الحكم والتوثيق</td>
        </tr>
        <tr class="c-table-kv__val">
            <td>{_L3_CLARIFICATION}</td>
            <td>{_L3_INPUTS}</td>
            <td>{_L3_CLASSIFICATION}</td>
            <td>{_L3_SOURCE}</td>
            <td>{_L3_RULING}</td>
        </tr>

    </table>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">5</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
