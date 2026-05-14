"""
page10_finishing_utilities.py — تصنيف مستوى تشطيبات البناء / المرافق / المحيط

Components used
---------------
  .c-page-header          →  logo header
  .c-section-heading      →  teal section bar
  .c-text-body            →  body paragraphs
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

    <!-- ══════════════════════════════════════════════════════════════════
         SECTION 1: تصنيف مستوى تشطيبات البناء
         ══════════════════════════════════════════════════════════════════ -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading">تصنيف مستوى تشطيبات البناء</div>
    </div>

    <div style="
        position: relative; z-index: 2;
        border: 1px solid var(--border-light);
        border-radius: 0 0 2mm 2mm;
        margin-bottom: 5mm;
        overflow: hidden;
    ">

        <!-- Sub-heading: مستوى التشطيب -->
        <div style="
            background: rgba(15,139,148,0.10);
            color: var(--teal-primary);
            font-weight: 700;
            font-size: 9.5pt;
            padding: 2mm 4mm;
            border-bottom: 1px solid var(--border-light);
            text-align: right;
        ">مستوى التشطيب</div>

        <!-- Checkboxes row -->
        <div style="padding: 3mm 4mm; border-bottom: 1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border: none;">
                <tr>
                    <td style="border: 1px solid var(--border-light); width:25%;">☐ تشطيب فاخر</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ تشطيب متوسط</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☐ تشطيب عادي</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☐ بدون تشطيب</td>
                </tr>
            </table>
        </div>

        <!-- Sub-heading: وصف التشطيب -->
        <div style="
            background: rgba(15,139,148,0.10);
            color: var(--teal-primary);
            font-weight: 700;
            font-size: 9.5pt;
            padding: 2mm 4mm;
            border-bottom: 1px solid var(--border-light);
            text-align: right;
        ">وصف التشطيب</div>

        <!-- First finishing table: الأبواب / العوازل / الأسقف -->
        <div style="padding: 0;">
            <table style="
                width: 100%;
                border-collapse: collapse;
                font-size: 9.5pt;
                direction: rtl;
            ">
                <thead>
                    <tr>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 20%;">نوعية العزل</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 20%;">أنواع الأسقف</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 20%;">الأبواب الداخلية</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 20%;">الأبواب الخارجية</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">حريري مائي</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">خرسانة مسلحة</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">زجاج</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">زجاج</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Second finishing table: الأرضيات -->
        <div style="padding: 0;">
            <table style="
                width: 100%;
                border-collapse: collapse;
                font-size: 9.5pt;
                direction: rtl;
            ">
                <thead>
                    <tr>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرضية الأحواش</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرضية الاستقبال</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرضية المدخل</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرضية الغرف</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">بلاط</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">سيراميك</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">رخام</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">سيراميك</td>
                    </tr>
                </tbody>
            </table>
        </div>

    </div><!-- end section 1 inner box -->


    <!-- ══════════════════════════════════════════════════════════════════
         SECTION 2: الخدمات والمرافق المتوفرة بالعقار
         ══════════════════════════════════════════════════════════════════ -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading">الخدمات والمرافق المتوفرة بالعقار</div>
    </div>

    <div style="
        position: relative; z-index: 2;
        border: 1px solid var(--border-light);
        border-radius: 0 0 2mm 2mm;
        margin-bottom: 5mm;
        overflow: hidden;
    ">
        <!-- Top checkboxes row: الصرف / الهاتف / المياه / الكهرباء -->
        <div style="padding: 3mm 4mm; border-bottom: 1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border: none;">
                <tr>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ الصرف الصحي</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ الهاتف</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ المياه</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ الكهرباء</td>
                </tr>
            </table>
        </div>

        <!-- Meters detail table -->
        <div style="padding: 0;">
            <table style="
                width: 100%;
                border-collapse: collapse;
                font-size: 9.5pt;
                direction: rtl;
            ">
                <thead>
                    <tr>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">عدد عدادات المياه</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">عدد عدادات الكهرباء</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرقام عدادات المياه</th>
                        <th style="background: rgba(15,139,148,0.06); color: var(--teal-primary); font-weight: 700; text-align: center; padding: 2mm 3mm; border: 1px solid var(--border-light); width: 25%;">أرقام عدادات الكهرباء</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">0</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--teal-dark); font-weight: 600;">0</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-muted);">—</td>
                        <td style="border: 1px solid var(--border-light); padding: 2.5mm 3mm; text-align: center; background: var(--bg-table-cell); color: var(--text-muted);">—</td>
                    </tr>
                </tbody>
            </table>
        </div>

    </div><!-- end section 2 inner box -->


    <!-- ══════════════════════════════════════════════════════════════════
         SECTION 3: المحيط المؤثر للعقار
         ══════════════════════════════════════════════════════════════════ -->
    <div style="margin-bottom: 3mm; position: relative; z-index: 2;">
        <div class="c-section-heading">المحيط المؤثر للعقار</div>
    </div>

    <div style="
        position: relative; z-index: 2;
        border: 1px solid var(--border-light);
        border-radius: 0 0 2mm 2mm;
        margin-bottom: 5mm;
        overflow: hidden;
    ">
        <!-- Row 1: جامع / مرفق طبي / مرفق أمني / مرفق تعليمي -->
        <div style="padding: 3mm 4mm; border-bottom: 1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border: none;">
                <tr>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ جامع</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ مرفق طبي</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ مرفق أمني</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ مرفق تعليمي</td>
                </tr>
            </table>
        </div>

        <!-- Row 2: خدمات أخرى -->
        <div style="padding: 3mm 4mm; border-bottom: 1px solid var(--border-light);">
            <table class="c-checkbox-table" style="border: none;">
                <tr>
                    <td style="
                        border: 1px solid var(--border-light);
                        width: 25%;
                        background: rgba(15,139,148,0.07);
                        color: var(--teal-primary);
                        font-weight: 700;
                        text-align: right;
                        padding: 2.5mm 4mm;
                    ">خدمات أخرى</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ سوق تجاري</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ حديقة</td>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ مقر حكومي</td>
                </tr>
            </table>
        </div>

        <!-- Row 3: طريق سريع -->
        <div style="padding: 3mm 4mm;">
            <table class="c-checkbox-table" style="border: none;">
                <tr>
                    <td style="border: 1px solid var(--border-light); width:25%;">☑ طريق سريع</td>
                    <td style="border: 1px solid var(--border-light); width:75%; text-align: right; color: var(--text-muted);"></td>
                </tr>
            </table>
        </div>

    </div><!-- end section 3 inner box -->


    <!-- FOOTER -->
    <div class="statement-footer">
        <div class="footer-ribbon">
            <div class="footer-page">10</div>
        </div>
        <div class="footer-content">
            <span class="c-text-tiny">920000694</span>
            <span class="c-text-tiny">info@taqdeer.com</span>
            <span class="c-text-tiny">www.taqdeer.com</span>
        </div>
    </div>

</div>
"""
