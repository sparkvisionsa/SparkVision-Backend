"""
page12_methodology.py — أسلوب/طريقة التقييم المستخدمة

Components used
---------------
  .c-page-header          →  logo header
  .c-section-heading      →  teal section bar
  .c-checkbox-table       →  approach checkboxes (section 1)
  .c-text-body            →  justification paragraph (section 2)
  5-column inline table   →  method comparison grid (section 3)
"""


def render(data: dict) -> str:
    tx = data.get("tx", {})

    # Which approaches are used (for checkboxes)
    used_market = tx.get("usedMarket", True)
    used_income = tx.get("usedIncome", False)
    used_cost = tx.get("usedCost", True)

    # Section 2 justification text
    justification = tx.get("methodJustification") or (
        "تم استخدام أسلوب السوق لتقدير قيمة الأرض لكونها غير مستهلكة وتعكس قيمتها بشكل دقيد من خلال "
        "الصفقات الفعلية للمعاملات المماثلة، بينما تم استخدام أسلوب التكلفة لتقدير قيمة المباني لملاءمته "
        "في احتساب تكلفة الإنشاء الحالية بعد خصم الاستهلاك."
    )

    def cb(flag):
        return "☑" if flag else "☐"

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

    <!-- ── SECTION 1: أسلوب/طريقة التقييم المستخدمة ─────────── -->
    <div style="margin-bottom: 5mm; position: relative; z-index: 2;">
        <div class="c-section-heading">أسلوب/طريقة التقييم المستخدمة</div>
        <table class="c-checkbox-table">
            <tr>
                <td>{cb(used_market)}  أسلوب السوق</td>
                <td>{cb(used_income)}  أسلوب الدخل</td>
                <td>{cb(used_cost)}    أسلوب التكلفة</td>
            </tr>
            <tr>
                <td>طريقة المقارنة</td>
                <td>طريقة رسملة الدخل</td>
                <td>طريقة الإحلال</td>
            </tr>
        </table>
    </div>

    <!-- ── SECTION 2: مبررات التقييم ────────────────────────── -->
    <div style="margin-bottom: 5mm; position: relative; z-index: 2;">
        <div class="c-section-heading c-section-heading--pill"
             style="margin-bottom: 3mm;">مبررات التقييم</div>
        <p class="c-text-body" style="margin-bottom: 0;">{justification}</p>
    </div>

    <!-- ── SECTION 3: 5-column method grid ───────────────────── -->
    <div style="position: relative; z-index: 2;">

        <!-- 5-part section heading -->
        <div class="c-section-heading" style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2.5mm 4mm;
            border-radius: 2mm 2mm 0 0;
            gap: 0;
        ">
            <span style="flex:1.4; text-align:center;">الأسلوب/الطريقة</span>
            <span style="width:1px; background:rgba(255,255,255,0.3); align-self:stretch; margin:0 2mm;"></span>
            <span style="flex:1.6; text-align:center;">الوصف</span>
            <span style="width:1px; background:rgba(255,255,255,0.3); align-self:stretch; margin:0 2mm;"></span>
            <span style="flex:2; text-align:center;">آلية عمل الطريقة</span>
            <span style="width:1px; background:rgba(255,255,255,0.3); align-self:stretch; margin:0 2mm;"></span>
            <span style="flex:1.6; text-align:center;">أسباب الاستخدام</span>
            <span style="width:1px; background:rgba(255,255,255,0.3); align-self:stretch; margin:0 2mm;"></span>
            <span style="flex:1.4; text-align:center;">الملاحظات</span>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:8.5pt; direction:rtl;">

            <!-- ── ROW 1: أسلوب السوق / طريقة المقارنة ── -->
            <tr>
                <!-- col 1: method name — teal label style -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           color:var(--teal-primary); font-weight:700;
                           vertical-align:top; text-align:right; width:14%;
                           background:rgba(15,139,148,0.06);">
                    أسلوب السوق<br>
                    <span style="font-weight:400; color:var(--teal-dark); font-size:8pt;">
                        طريقة المقارنة<br>- مساعد
                    </span>
                </td>
                <!-- col 2: description -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; width:18%; text-align:right;">
                    تستند هذه الطريقة إلى مقارنة العقار المراد تقييمه مع عقارات مشابهة تم بيعها مؤخرًا في نفس المنطقة أو مناطق مشابهة. يتم استخدام معلومات عن صفقات البيع الفعلية لتحديد قيمة العقار.
                </td>
                <!-- col 3: mechanism -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; width:22%; text-align:right;">
                    جمع بيانات مبيعات العقارات المشابهة.<br>
                    تعديل الأسعار استنادًا إلى الفروقات بين العقارات (مثل إضافة قيمة إذا كان العقار المراد تقييمه يحتوي على مزايا إضافية أو خصم إذا كان يفتقد لبعض المزايا).<br>
                    تحليل الصفات المميزة لكل عقار مثل المساحة والموقع وحالة العقار وتجهيزاته.<br>
                    توفير تقدير موضوعي يستند إلى السوق الفعلي وليس على التقديرات النظرية.
                </td>
                <!-- col 4: reasons -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; width:22%; text-align:right;">
                    دقة نسبية في تحديد القيمة العادلة للعقار في ظل وجود معاملات مماثلة حديثة.<br>
                    توفر بيانات مبيعات مشابهة وسهولة الوصول إليها.
                </td>
                <!-- col 5: notes -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; width:24%; text-align:right;">
                    يمكن أن تكون هناك تحديات في حالات السوق غير المستقر أو في المناطق التي تشهد قلة في المعاملات.<br>
                    يجب أن تكون المقارنات دقيقة لضمان صحة التقييم مع مراعاة كافة الفروقات بين العقارات المشابهة.<br>
                    يعتمد نجاح هذه الطريقة على توفر بيانات مبيعات دقيقة وحديثة.
                </td>
            </tr>

            <!-- ── ROW 2: أسلوب التكلفة / طريقة الإحلال ── -->
            <tr>
                <!-- col 1 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           color:var(--teal-primary); font-weight:700;
                           vertical-align:top; text-align:right;
                           background:rgba(15,139,148,0.06);">
                    أسلوب التكلفة<br>
                    <span style="font-weight:400; color:var(--teal-dark); font-size:8pt;">
                        طريقة الإحلال<br>- أساسي
                    </span>
                </td>
                <!-- col 2 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right;">
                    تتمثل هذه الطريقة في تقدير تكلفة بناء عقار جديد بنفس مواصفات العقار المراد تقييمه، ثم يتم تعديل هذه التكلفة حسب حالة العقار (الإهلاك) للحصول على القيمة الحالية للعقار.
                </td>
                <!-- col 3 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right;">
                    جمع تكلفة الأرض وتكلفة البناء المعدّلة لتحديد القيمة الإجمالية للعقار.<br>
                    احتساب الإهلاك (إجمالي الإهلاك = الإهلاك الوظيفي والإهلاك الاقتصادي والإهلاك المادي).<br>
                    تقدير تكلفة الأرض.<br>
                    يعطي فكرة عن تكلفة استبدال العقار بنفس الجودة والمواصفات.
                </td>
                <!-- col 4 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right;">
                    مناسب للعقارات التي يصعب إيجاد معاملات مقارنة لها.<br>
                    مفيد لتقييم العقارات الجديدة أو الحديثة البناء.
                </td>
                <!-- col 5 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right;">
                    قد يكون غير مناسب للعقارات القديمة جدًا بسبب صعوبة تقدير الإهلاك بدقة.<br>
                    يمكن أن يكون أقل دقة في الأسواق ذات التغيرات السريعة في الأسعار.<br>
                    يتطلب تقديرات دقيقة لتكاليف البناء والإهلاك.
                </td>
            </tr>

            <!-- ── ROW 3: أسلوب الدخل — not used ── -->
            <tr>
                <!-- col 1 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           color:var(--text-muted); font-weight:700;
                           vertical-align:top; text-align:right;
                           background:rgba(0,0,0,0.02);">
                    أسلوب الدخل<br>
                    <span style="font-weight:400; font-size:8pt;">
                        لم يُستخدم
                    </span>
                </td>
                <!-- col 2 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right; color:var(--text-muted);">
                    يستخدم هذا الأسلوب لتحويل صافي دخل العقار المتوقع إلى قيمة حالية باستخدام معدل رسملة مناسب. يُعتبر مناسبًا للعقارات التجارية التي تدر دخلًا ثابتًا.
                </td>
                <!-- col 3 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right; color:var(--text-muted);">
                    تحديد صافي الدخل التشغيلي (NOI) للعقار.<br>
                    تحديد معدل الرسملة المناسب استنادًا إلى ظروف السوق وظروف العقار (Cap Rate).<br>
                    معادلة الرسملة: قيمة العقار = صافي الدخل التشغيلي ÷ معدل الرسملة.<br>
                    بسيط وسهل التطبيق مما يجعله شائع الاستخدام في تقييم العقارات التجارية.<br>
                    اعتمد على دخل العقار مما يجعله مناسبًا للعقارات المدرّة للدخل.<br>
                    يوفر تقديرًا سريعًا للقيمة بناءً على أداء العقار الفعلي.
                </td>
                <!-- col 4 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right; color:var(--text-muted);">
                    يتطلب تقديرًا دقيقًا لصافي الدخل التشغيلي ومعدل الرسملة.<br>
                    يمكن أن يكون غير دقيق إذا كانت هناك تقلبات كبيرة في دخل العقار أو ظروف السوق.<br>
                    يتطلب فهمًا جيدًا للسوق المحلي ومعدلات الرسملة المتداولة فيه.
                </td>
                <!-- col 5 -->
                <td style="border:1px solid var(--border-light); padding:2.5mm 3mm;
                           background:var(--bg-table-cell); vertical-align:top;
                           line-height:1.6; text-align:right; color:var(--text-muted);">
                    —
                </td>
            </tr>

        </table>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">12</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
