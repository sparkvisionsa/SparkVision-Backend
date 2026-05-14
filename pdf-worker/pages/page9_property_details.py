"""
page9_property_details.py — تفاصيل موقع العقار

Components used
---------------
  .c-page-header          →  logo header
  .c-section-heading      →  teal section bar
  .c-text-body            →  body paragraphs
  .c-table-compact        →  key-value table for property location details
  .c-checkbox-table       →  checkbox option tables
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

    <!-- ── SECTION 1: تفاصيل موقع العقار ─────────────────────────────── -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading">تفاصيل موقع العقار</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 5mm;">
        <table class="c-table-compact">
            <tr>
                <td class="c-table-compact__label">المنطقة</td>
                <td class="c-table-compact__value">{ev.get("region", "")}</td>
                <td class="c-table-compact__label">المدينة</td>
                <td class="c-table-compact__value">{ev.get("city", "")}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">الحي</td>
                <td class="c-table-compact__value">{ev.get("district", "")}</td>
                <td class="c-table-compact__label">الشارع</td>
                <td class="c-table-compact__value">{ev.get("street", "")}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">رقم القطعة</td>
                <td class="c-table-compact__value">{ev.get("plot_number", "")}</td>
                <td class="c-table-compact__label">رقم المخطط</td>
                <td class="c-table-compact__value">{ev.get("plan_number", "")}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">إحداثيات الموقع</td>
                <td class="c-table-compact__value">{ev.get("coordinates", "")}</td>
                <td class="c-table-compact__label">نوع العقار</td>
                <td class="c-table-compact__value">{ev.get("property_type", "")}</td>
            </tr>
            <tr>
                <td class="c-table-compact__label">رقم الصك</td>
                <td class="c-table-compact__value">{ev.get("deed_number", "")}</td>
                <td class="c-table-compact__label">تاريخ الصك</td>
                <td class="c-table-compact__value">{ev.get("deed_date", "")}</td>
            </tr>
        </table>
    </div>

    <!-- ── SECTION 2: وصف العقار ──────────────────────────────────────── -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading c-section-heading--pill" style="border-radius: 2mm;">وصف العقار</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 5mm;">
        <p class="c-text-body">
            العقار عبارة عن مجمع تجاري مكون من: دور أرضي ودور أول ودور ثاني
        </p>
    </div>

    <!-- ── SECTION 3: حالة العقار ─────────────────────────────────────── -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading c-section-heading--pill" style="border-radius: 2mm;">حالة العقار</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 5mm;">

        <!-- حالة المبنى row -->
        <p class="c-text-body" style="color: var(--teal-primary); font-weight: 700; margin-bottom: 2mm;">حالة المبنى</p>
        <div class="c-checkbox-block" style="margin-bottom: 3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:25%;">☑ جديد</td>
                    <td style="width:25%;">☐ مستخدم</td>
                    <td style="width:25%;">☐ تحت الإنشاء</td>
                    <td style="width:25%;">☐ أخرى</td>
                </tr>
            </table>
        </div>

        <!-- نسبة اكتمال البناء row -->
        <div style="display: flex; align-items: center; gap: 6mm; margin-bottom: 3mm;">
            <p class="c-text-body" style="color: var(--teal-primary); font-weight: 700; margin: 0; white-space: nowrap;">
                نسبة اكتمال البناء:
            </p>
            <div style="
                border: 1px solid var(--border-light);
                background: var(--bg-table-cell);
                padding: 2mm 6mm;
                border-radius: 2mm;
                color: var(--teal-dark);
                font-weight: 700;
                font-size: 10.5pt;
                min-width: 30mm;
                text-align: center;
            ">100%</div>
        </div>
    </div>

    <!-- ── SECTION 4: أبعاد وأطوال العقار ───────────────────────────── -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading" style="
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 2.5mm 4mm;
            border-radius: 2mm 2mm 0 0;
        ">أبعاد وأطوال العقار</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 5mm;">
        <table style="
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
            direction: rtl;
        ">
            <!-- Column header row -->
            <thead>
                <tr>
                    <th style="background: rgba(15,139,148,0.12); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2.5mm 3mm; border: 1px solid var(--border-light);">الجهة</th>
                    <th style="background: rgba(15,139,148,0.12); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2.5mm 3mm; border: 1px solid var(--border-light);">الوصف</th>
                    <th style="background: rgba(15,139,148,0.12); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2.5mm 3mm; border: 1px solid var(--border-light);">الطول</th>
                    <th style="background: rgba(15,139,148,0.12); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2.5mm 3mm; border: 1px solid var(--border-light);">الواجهات</th>
                    <th style="background: rgba(15,139,148,0.12); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2.5mm 3mm; border: 1px solid var(--border-light);">المساحات</th>
                </tr>
            </thead>
            <tbody>
                <!-- شمالي -->
                <tr>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; color: var(--teal-primary); font-weight: 700; text-align: center; background: var(--bg-table-cell); white-space: nowrap;">شمالي</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: right; background: var(--bg-table-cell); line-height: 1.6; color: var(--text-body);">
                        ملك مشترك بين البادر وعبد الكريم المشتري خاص بهما
                    </td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">61.65 م</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-body);">شارع (داخلي)</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">
                        مساحة الأرض (م²)<br>
                        <span style="font-size: 10pt;">3,528</span>
                    </td>
                </tr>
                <!-- جنوبي -->
                <tr>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; color: var(--teal-primary); font-weight: 700; text-align: center; background: var(--bg-table-cell); white-space: nowrap;">جنوبي</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: right; background: var(--bg-table-cell); line-height: 1.6; color: var(--text-body);">
                        ملك عبد اللطيف
                    </td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">71 م</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-body);">شارع (داخلي)</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">
                        مساحة المباني (م²)<br>
                        <span style="font-size: 10pt;">8100.00</span>
                    </td>
                </tr>
                <!-- شرقي -->
                <tr>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; color: var(--teal-primary); font-weight: 700; text-align: center; background: var(--bg-table-cell); white-space: nowrap;">شرقي</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: right; background: var(--bg-table-cell); line-height: 1.6; color: var(--text-body);">
                        بقية الملك
                    </td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">53.3 م</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-body);">شارع (داخلي)</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">
                        الملاحق (م²)<br>
                        <span style="font-size: 10pt;">0.00</span>
                    </td>
                </tr>
                <!-- غربي -->
                <tr>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; color: var(--teal-primary); font-weight: 700; text-align: center; background: var(--bg-table-cell); white-space: nowrap;">غربي</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: right; background: var(--bg-table-cell); line-height: 1.6; color: var(--text-body);">
                        شارع الروضة عرض 20 م
                    </td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">53.3 م</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-body);">شارع رئيسي</td>
                    <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">
                        مساحة الأسوار (م²)<br>
                        <span style="font-size: 10pt;">0.00</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- ── SECTION 5: معلومات رخصة البناء ────────────────────────────── -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading c-section-heading--pill" style="border-radius: 2mm;">معلومات رخصة البناء</div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 3mm;">
        <div class="c-checkbox-block" style="margin-bottom: 3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:33%; color: var(--teal-primary); font-weight: 700;">مطابق لرخصة البناء</td>
                    <td style="width:33%;">☐ نعم</td>
                    <td style="width:33%;">☑ لا</td>
                </tr>
            </table>
        </div>
        <div class="c-checkbox-block" style="margin-bottom: 3mm;">
            <table class="c-checkbox-table">
                <tr>
                    <td style="width:33%; color: var(--teal-primary); font-weight: 700;">حدود المعاينة</td>
                    <td style="width:67%;">معاينة ميدانية</td>
                </tr>
            </table>
        </div>
    </div>

    <div style="position: relative; z-index: 2; margin-bottom: 4mm;">
        <p class="c-text-body">
            <span class="c-highlight">ملاحظات: </span>
            تم احتساب مساحات وتحطيط العقار تقديريًا لعدم توفر رخصة بناء العقار.. ويلزم قراراً مساحياً ورقم قطعة ومخططه للتأكد والمطابقة.
        </p>
    </div>

    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">9</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
