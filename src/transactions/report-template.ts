// ─── report-template.ts ─────────────────────────────────────────────────────
// Page flow: cover → table of contents → certification summary → detailed
// scope of work → disclaimers/IVS compliance → fair-value data hierarchy →
// sources & reliability → process diagram → property details (section
// banner, no divider page) → finishing/services → valuation method (section
// banner) → methodology → market approach (comps + settlement) → cost
// approach (building breakdown + replacement calc) → investment approach
// (only if used) → final opinion & consolidated sign-off → appendices
// (section banner) → maps → photos → attachment pages → thank-you.
//
// CHANGE LOG (this revision):
// - Removed all `dividerPage()` full-page section breaks. Each section that
//   used to open with a standalone divider page now opens with a
//   `.section-banner` rendered inline at the top of its first content page
//   — same visual weight, zero extra pages.
// - Added a computed Table of Contents page (real page numbers, two-pass:
//   `planPages()` resolves page numbers before `renderReportHtml()` builds
//   HTML strings).
// - Consolidated the sign-off. Previously: "المشاركون في إعداد التقرير"
//   (inspector/preparer) + "توقيعات المقيّمين المعتمدين والعميل"
//   (authors+client) + "اعتماد المقيّم المعتمد" (lead, again) rendered the
//   lead appraiser's name/membership twice. Now: one
//   "التوقيعات واعتماد التقرير" section with all signatories in one grid,
//   plus a single closing "اعتماد نهائي" stamp line — no duplicate card.
// - Added a report-version badge on the cover (`d.reportVersion`, defaults
//   to "1.0") so a re-issued/amended report is visibly distinguishable.
// - ESG section is now a compact 3-row table (Environmental / Social /
//   Governance) instead of one dense paragraph.
// - Photo captions are numbered ("1. filename") for easier cross-reference
//   from the report body.
// - Pages no longer clip content early (`.page{overflow:hidden}` removed
//   from interior pages) — unchanged from previous revision.
// - Numbers: global `font-feature-settings:"locl" 0` + lining-nums so the
//   Arabic webfont can't swap in Eastern-Arabic digit glyphs — unchanged.

import type { ReportData } from "./report-types";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const STYLES = `
:root{
  --navy-900:#0A2540; --navy-800:#0F3157; --blue-700:#0F4C81; --blue-600:#155A94;
  --blue-500:#2E75B6; --blue-200:#CFE1F2; --blue-100:#EAF2FA; --blue-50:#F5F9FD;
  --white:#FFFFFF; --gold:#B98B34; --gold-soft:#D8B968; --ink:#16232E;
  --gray-600:#5C6B7A; --gray-400:#93A1AF; --line:#DCE6F0; --page-w:794px; --page-h:1123px;
}
*{box-sizing:border-box; margin:0; padding:0;}
body{background:#8FA6BC; font-family:'IBM Plex Sans Arabic', 'Cairo', sans-serif; color:var(--ink);
  font-feature-settings:"locl" 0, "tnum" 1; font-variant-numeric: lining-nums;
}
h1,h2,h3,.display{font-family:'Cairo', sans-serif;}
.page{width:var(--page-w); min-height:var(--page-h); background:var(--white); position:relative; page-break-after:always;}
.page.cover, .page.thankyou{overflow:hidden;}
.page.interior{overflow:visible; display:flex; flex-direction:column;}
.cover{background:linear-gradient(165deg, var(--navy-900) 0%, var(--blue-700) 58%, var(--blue-500) 100%); color:var(--white); display:flex; flex-direction:column; justify-content:space-between; padding:52px 56px 0 56px;}
.cover-top{display:flex; justify-content:space-between; align-items:flex-start;}
.brand{display:flex; align-items:center; gap:12px;}
.brand-mark{width:44px; height:44px; border-radius:10px; background:linear-gradient(135deg, var(--gold-soft), var(--gold)); display:flex; align-items:center; justify-content:center; font-family:'Cairo',sans-serif; font-weight:800; color:var(--navy-900); font-size:20px;}
.brand-name{font-family:'Cairo',sans-serif; font-weight:700; font-size:20px; letter-spacing:.3px;}
.brand-sub{font-size:11px; color:var(--blue-200); letter-spacing:1.5px; margin-top:2px;}
.cover-badges{display:flex; gap:8px;}
.report-no-badge{border:1px solid rgba(255,255,255,.35); border-radius:999px; padding:6px 16px; font-size:12px; color:var(--blue-100);}
.version-badge{border:1px solid rgba(216,185,104,.55); background:rgba(216,185,104,.12); border-radius:999px; padding:6px 16px; font-size:12px; color:var(--gold-soft);}
.cover-mid{padding-top:60px;}
.eyebrow{display:flex; align-items:center; gap:10px; color:var(--gold-soft); font-size:13px; letter-spacing:2px; margin-bottom:18px;}
.eyebrow::before{content:""; width:34px; height:2px; background:var(--gold-soft); display:inline-block;}
.cover-title{font-size:44px; font-weight:800; line-height:1.25; max-width:560px;}
.cover-title span{color:var(--gold-soft);}
.cover-desc{margin-top:18px; font-size:15px; color:var(--blue-100); max-width:480px; line-height:1.9;}
.cover-skyline-wrap{position:relative; margin-top:44px; height:200px;}
.cover-skyline-wrap svg{position:absolute; bottom:0; width:100%; height:100%;}
.cover-info-card{background:var(--white); color:var(--ink); border-radius:18px 18px 0 0; margin:0 -56px 0 -56px; padding:30px 56px 34px 56px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:22px; position:relative; z-index:2;}
.info-item .label{font-size:11px; color:var(--gray-600); margin-bottom:6px;}
.info-item .value{font-size:14px; font-weight:600; color:var(--navy-800);}
.info-item.wide{grid-column:1/-1; border-top:1px dashed var(--line); padding-top:16px; margin-top:2px;}
.page.interior{padding:0;}
.header-bar{flex-shrink:0; height:56px; background:var(--blue-50); border-bottom:2px solid var(--blue-700); display:flex; align-items:center; justify-content:space-between; padding:0 42px;}
.header-bar .h-brand{display:flex; align-items:center; gap:8px;}
.header-bar .h-brand .dot{width:9px;height:9px;border-radius:50%;background:var(--gold);}
.header-bar .h-brand span{font-family:'Cairo',sans-serif; font-weight:700; color:var(--navy-800); font-size:13.5px;}
.header-bar .h-section{font-size:11.5px; color:var(--gray-600);}
.content{flex:1 1 auto; padding:26px 42px 32px 42px;}

/* Section banner — replaces the old standalone divider page. Sits inline at
   the top of the first content page of a major part (property details /
   valuation method / appendices), same visual weight, zero extra pages. */
.section-banner{background:linear-gradient(120deg, var(--navy-900), var(--blue-700)); color:#fff; border-radius:14px; padding:22px 26px; margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; page-break-inside:avoid; page-break-after:avoid;}
.section-banner h1{font-size:24px; font-weight:800;}
.section-banner .tag{font-size:11px; color:var(--blue-200); letter-spacing:1.5px; margin-top:4px;}

.section-title{display:flex; align-items:center; gap:11px; margin:17px 0 9px 0; page-break-after:avoid;}
.section-title:first-child{margin-top:0;}
.section-title .num{font-family:'Cairo',sans-serif; font-weight:800; font-size:12.5px; color:var(--white); background:var(--blue-700); width:24px; height:24px; border-radius:7px; display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.section-title h2{font-size:14.5px; color:var(--navy-800); font-weight:700;}
.section-title .rule{flex:1; height:1px; background:var(--line);}
.band{background:var(--blue-700); color:#fff; font-size:12px; font-weight:700; padding:8px 15px; border-radius:8px; margin:15px 0 9px 0;}
.card{border:1px solid var(--line); border-radius:11px; overflow:hidden; margin-bottom:11px; page-break-inside:avoid;}
.card.compact{margin-bottom:7px;}
.kv-grid{display:grid; grid-template-columns:repeat(3,1fr);}
.kv-grid.cols2{grid-template-columns:repeat(2,1fr);}
.kv-grid .kv{padding:10px 14px; border-bottom:1px solid var(--line); border-inline-start:1px solid var(--line); page-break-inside:avoid;}
.kv-grid .kv:nth-child(3n+1){border-inline-start:none;}
.kv-grid.cols2 .kv:nth-child(2n+1){border-inline-start:none;}
.kv .label{font-size:10px; color:var(--gray-600); margin-bottom:3px;}
.kv .value{font-size:11.5px; font-weight:600; color:var(--navy-800); line-height:1.55;}
.prose{padding:11px 15px; font-size:11px; line-height:1.85; color:var(--ink);}
.prose.muted{color:var(--gray-600);}
table{width:100%; border-collapse:collapse; font-size:10.5px;}
thead{display:table-header-group;}
thead th{background:var(--blue-700); color:var(--white); font-weight:600; padding:7px 9px; text-align:center; font-size:10px;}
tbody tr{page-break-inside:avoid;}
tbody td{padding:6px 9px; text-align:center; border-bottom:1px solid var(--line); color:var(--ink);}
tbody tr:nth-child(even){background:var(--blue-50);}
tbody tr td:first-child{font-weight:600; color:var(--blue-700);}
.highlight-box{background:var(--blue-50); border:1px solid var(--blue-200); border-radius:11px; padding:15px 20px; display:flex; align-items:center; justify-content:space-between; margin:12px 0; page-break-inside:avoid;}
.highlight-box .label{font-size:11px; color:var(--gray-600); margin-bottom:4px;}
.highlight-box .amount{font-family:'Cairo',sans-serif; font-size:23px; font-weight:800; color:var(--navy-800);}
.highlight-box .amount .cur{font-size:13.5px; color:var(--gold); margin-inline-end:6px;}
.highlight-box .written{font-size:11px; color:var(--blue-700); margin-top:4px;}
.checkline{display:flex; gap:15px; flex-wrap:wrap; margin:9px 0;}
.checkitem{display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--ink);}
.checkitem .box{width:14px; height:14px; border-radius:4px; border:1.5px solid var(--blue-500); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
.checkitem.active .box{background:var(--blue-700); border-color:var(--blue-700);}
.checkitem.active .box::after{content:"✓"; color:#fff; font-size:9.5px;}
.one-page-group{page-break-inside:avoid;}
.footer-bar{flex-shrink:0; margin-top:auto; padding:11px 42px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; font-size:9.5px; color:var(--gray-600); background:var(--white);}
.footer-bar .fbrand{display:flex; align-items:center; gap:8px; font-family:'Cairo',sans-serif; font-weight:700; color:var(--navy-800);}
.page-num{width:23px; height:23px; border-radius:50%; background:var(--blue-700); color:#fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700;}
.signature-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:5px;}
.sig-card{border:1px solid var(--line); border-radius:11px; padding:12px 15px; page-break-inside:avoid;}
.sig-card .role{font-size:10px; color:var(--gold); font-weight:700; margin-bottom:5px;}
.sig-card .name{font-size:12.5px; font-weight:700; color:var(--navy-800);}
.sig-line{margin-top:8px; border-top:1px dashed var(--line); padding-top:5px; font-size:9.5px; color:var(--gray-600);}
.sig-box{margin-top:8px; height:44px; border:1px dashed var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:9.5px; color:var(--gray-400);}
.sig-box.has-image{border-style:solid; padding:2px;}
.sig-box img{max-width:100%; max-height:100%; object-fit:contain;}
.final-approval{margin-top:14px; padding:14px 18px; border:1px solid var(--gold-soft); background:var(--blue-50); border-radius:11px; display:flex; justify-content:space-between; align-items:center; page-break-inside:avoid;}
.final-approval .tag{font-size:10px; color:var(--gold); font-weight:700; margin-bottom:4px;}
.final-approval .name{font-family:'Cairo',sans-serif; font-weight:700; font-size:14px; color:var(--navy-800);}
.final-approval .meta{font-size:10.5px; color:var(--gray-600); margin-top:4px;}
.image-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:11px;}
.image-grid figure{margin:0; border:1px solid var(--line); border-radius:9px; overflow:hidden; background:var(--blue-50); page-break-inside:avoid;}
.image-grid img{width:100%; height:142px; object-fit:cover; display:block;}
.image-grid figcaption{font-size:9.5px; color:var(--gray-600); padding:6px 7px; text-align:center;}
.attach-cover{display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:0 60px;}
.attach-cover h2{font-size:20px; color:var(--navy-800); margin-bottom:9px;}
.attach-cover p{font-size:12px; color:var(--gray-600);}
.process-grid{display:flex; flex-direction:column; gap:10px;}
.process-step{display:flex; align-items:center; gap:13px; border:1px solid var(--line); border-radius:11px; padding:11px 16px; page-break-inside:avoid;}
.process-step .badge{width:34px; height:34px; border-radius:50%; background:var(--blue-700); color:#fff; display:flex; align-items:center; justify-content:center; font-family:'Cairo',sans-serif; font-weight:800; font-size:13px; flex-shrink:0;}
.process-step .txt h4{font-size:12px; color:var(--navy-800); margin-bottom:2px;}
.process-step .txt p{font-size:10.5px; color:var(--gray-600); line-height:1.65;}
.thankyou{background:linear-gradient(165deg, var(--navy-900) 0%, var(--blue-700) 58%, var(--blue-500) 100%); color:#fff; display:flex; align-items:flex-end; padding:56px;}
.thankyou h1{font-size:46px;}
.map-img{width:100%; max-height:370px; object-fit:cover; border-radius:11px; border:1px solid var(--line); display:block;}
.process-grid.compact{gap:6px;}
.process-step.compact{padding:7px 12px; gap:9px;}
.process-step.compact .badge{width:24px; height:24px; font-size:11px;}
.process-step.compact .txt h4{font-size:10.5px; margin-bottom:1px;}
.process-step.compact .txt p{font-size:9px; line-height:1.45;}

/* Table of contents */
.toc-list{display:flex; flex-direction:column;}
.toc-row{display:flex; align-items:baseline; gap:10px; padding:9px 0; border-bottom:1px dashed var(--line);}
.toc-row .toc-title{font-size:12.5px; font-weight:600; color:var(--navy-800); flex-shrink:0;}
.toc-row .toc-fill{flex:1; border-bottom:1px dotted var(--gray-400); transform:translateY(-3px);}
.toc-row .toc-page{font-family:'Cairo',sans-serif; font-weight:700; font-size:12px; color:var(--blue-700); flex-shrink:0;}
`;

function skylineSvg(opacity1 = 0.1, opacity2 = 0.22): string {
  return `<svg viewBox="0 0 794 230" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0,230 L0,150 L40,150 L40,110 L70,110 L70,150 L100,150 L100,80 L130,80 L130,150 L160,150 L160,60 L165,60 L165,20 L172,20 L172,60 L180,60 L180,150 L220,150 L220,100 L250,100 L250,150 L300,150 L300,40 L330,40 L330,150 L370,150 L370,120 L400,120 L400,150 L430,150 L430,90 L460,90 L460,150 L500,150 L500,30 L505,30 L505,10 L512,10 L512,30 L520,30 L520,150 L560,150 L560,110 L590,110 L590,150 L630,150 L630,70 L660,70 L660,150 L700,150 L700,100 L730,100 L730,150 L794,150 L794,230 Z" fill="rgba(255,255,255,${opacity1})"/>
    <path d="M0,230 L0,180 L30,180 L30,140 L55,140 L55,180 L90,180 L90,120 L120,120 L120,180 L150,180 L150,150 L185,150 L185,90 L210,90 L210,180 L245,180 L245,130 L275,130 L275,180 L315,180 L315,60 L318,60 L318,40 L324,40 L324,60 L330,60 L330,180 L365,180 L365,140 L395,140 L395,180 L430,180 L430,110 L460,110 L460,180 L495,180 L495,150 L525,150 L525,180 L560,180 L560,80 L563,80 L563,55 L570,55 L570,80 L575,80 L575,180 L615,180 L615,130 L645,130 L645,180 L680,180 L680,140 L710,140 L710,180 L745,180 L745,120 L775,120 L775,180 L794,180 L794,230 Z" fill="rgba(255,255,255,${opacity2})"/>
  </svg>`;
}

function headerBar(companyName: string, section: string): string {
  return `<div class="header-bar">
    <div class="h-brand"><span class="dot"></span><span>${esc(companyName)} للتقييم</span></div>
    <div class="h-section">${esc(section)}</div>
  </div>`;
}

function footerBar(companyName: string, pageNum: number): string {
  return `<div class="footer-bar">
    <div class="fbrand"><span>${esc(companyName)} للتقييم</span></div>
    <div>سجل تجاري: 0000000000 | ترخيص تقييم عقار: 0000000</div>
    <div class="page-num">${pageNum}</div>
  </div>`;
}

function check(active: boolean, label: string): string {
  return `<div class="checkitem ${active ? "active" : ""}"><span class="box"></span>${esc(label)}</div>`;
}

function sectionTitle(num: number | string, title: string): string {
  return `<div class="section-title"><div class="num">${num}</div><h2>${esc(title)}</h2><div class="rule"></div></div>`;
}

// Inline replacement for the old standalone divider page — same visual
// weight (large title on a navy band) but sits at the top of the first
// content page of the part instead of consuming its own page.
function sectionBanner(title: string, tag: string): string {
  return `<div class="section-banner"><div><h1>${esc(title)}</h1><div class="tag">${esc(tag)}</div></div></div>`;
}

function sigCard(role: string, name: string, membership?: string, imageDataUrl?: string | null): string {
  const box = imageDataUrl
    ? `<div class="sig-box has-image"><img src="${imageDataUrl}" /></div>`
    : `<div class="sig-box">الختم والتوقيع</div>`;
  return `<div class="sig-card">
    <div class="role">${esc(role)}</div>
    <div class="name">${esc(name)}</div>
    ${membership ? `<div class="sig-line">رقم العضوية: ${esc(membership)}</div>` : ""}
    ${box}
  </div>`;
}

// ── 1. Cover ──────────────────────────────────────────────────────────────
function coverPage(d: ReportData): string {
  return `<div class="page cover">
    <div class="cover-top">
      <div class="brand"><div class="brand-mark">S</div>
        <div><div class="brand-name">${esc(d.companyName)}</div><div class="brand-sub">للتقييم العقاري</div></div>
      </div>
      <div class="cover-badges">
        <div class="version-badge">الإصدار ${esc(d.reportVersion || "1.0")}</div>
        <div class="report-no-badge">تقرير رقم: ${esc(d.reportNumber)}</div>
      </div>
    </div>
    <div class="cover-mid">
      <div class="eyebrow">تقرير تقييم عقاري معتمد</div>
      <h1 class="cover-title">تقييم <span>عقاري</span><br>وفقًا لمعايير التقييم الدولية IVS</h1>
      <p class="cover-desc">إعداد تقرير تقييم شامل ومحايد يستند إلى معاينة ميدانية ودراسة سوقية دقيقة، لخدمة الأغراض المحاسبية والاستثمارية للعميل.</p>
    </div>
    <div class="cover-skyline-wrap">${skylineSvg()}</div>
    <div class="cover-info-card">
      <div class="info-item"><div class="label">العميل</div><div class="value">${esc(d.clientName)}</div></div>
      <div class="info-item"><div class="label">نوع العقار</div><div class="value">${esc(d.propertyTypeLabel)}</div></div>
      <div class="info-item"><div class="label">المدينة / الحي</div><div class="value">${esc(d.cityLine)}</div></div>
      <div class="info-item"><div class="label">تاريخ التقييم</div><div class="value">${esc(d.evalDate)}</div></div>
      <div class="info-item"><div class="label">الغرض من التقييم</div><div class="value">${esc(d.valuationPurposeLabel)}</div></div>
      <div class="info-item"><div class="label">أساس القيمة</div><div class="value">${esc(d.valuationBasisLabel)}</div></div>
      <div class="info-item wide"><div class="label">المقيّم المعتمد</div><div class="value">${esc(d.appraiserName)} — رقم العضوية ${esc(d.appraiserMembershipNo)}</div></div>
    </div>
  </div>`;
}

// ── Table of contents ────────────────────────────────────────────────────
// entries: [{ title, page }]. Page numbers are resolved by planPages()
// before this is rendered, so the TOC always points at the right physical
// page even as sections are conditionally included (investment approach,
// attachments, etc).
function tocPage(d: ReportData, pageNum: number, entries: { title: string; page: number }[]): string {
  const rows = entries
    .map((e) => `<div class="toc-row"><div class="toc-title">${esc(e.title)}</div><div class="toc-fill"></div><div class="toc-page">${e.page}</div></div>`)
    .join("");
  return `<div class="page interior">
    ${headerBar(d.companyName, "فهرس المحتويات")}
    <div class="content">
      ${sectionTitle(1, "فهرس المحتويات")}
      <div class="card"><div class="toc-list" style="padding:6px 16px;">${rows}</div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── 2. Certification summary (methods used + fair value + signature) ───────
function certificationSummaryPage(d: ReportData, pageNum: number): string {
  const a = d.approachesUsed;
  return `<div class="page interior">
    ${headerBar(d.companyName, "ملخص التقييم")}
    <div class="content">
      <p class="prose" style="padding:0 0 14px 0;">بناءً على طلب العميل ${esc(d.clientName)}، وبناءً على الترخيص الممنوح لنا من الهيئة السعودية للمقيمين المعتمدين، وبالالتزام بمعايير التقييم الدولية IVS، تم التوصل إلى القيمة العادلة للعقار بناءً على الكشف الفعلي على واقع العقار ومعاينته ودراسة المنطقة المحيطة به باستخدام:</p>
      <div class="band">أسلوب أو طريقة التقييم المستخدمة</div>
      <div class="checkline">
        ${check(a.marketComparison, "أسلوب السوق")}
        ${check(a.income, "أسلوب الدخل")}
        ${check(a.cost, "أسلوب التكلفة")}
        ${check(a.marketComparison, "طريقة المقارنة")}
        ${check(a.incomeCapitalization, "طريقة رسملة الدخل")}
        ${check(a.replacement, "طريقة الإحلال")}
      </div>
      <p class="prose" style="padding:14px 0;">نقدر القيمة العادلة لغرض <strong>${esc(d.valuationPurposeLabel)}</strong> وفقًا لتاريخ التقييم (تاريخ القياس) بعد الأخذ بالاعتبار جميع البيانات والمبادئ المنصوص عليها، فإننا نرى أن قيمة العقار مبلغ وقدره:</p>
      <div class="highlight-box"><div>
        <div class="label">القيمة العادلة (ريال سعودي)</div>
        <div class="amount"><span class="cur">﷼</span>${esc(d.fairValue)}</div>
        <div class="written">${esc(d.fairValueWritten)} لا غير</div>
      </div></div>

      <div class="card" style="margin-top:20px;"><div class="kv-grid cols2">
        <div class="kv"><div class="label">الاسم</div><div class="value">${esc(d.leadAppraiserName)}</div></div>
        <div class="kv"><div class="label">رقم العضوية</div><div class="value">${esc(d.leadAppraiserMembership)}</div></div>
        <div class="kv"><div class="label">فئة العضوية</div><div class="value">أساسي</div></div>
        <div class="kv"><div class="label">صفته</div><div class="value">${esc(d.leadAppraiserTitle)}</div></div>
        <div class="kv"><div class="label">تاريخ التقييم (تاريخ القياس)</div><div class="value">${esc(d.evalDate)}</div></div>
      </div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── 3. Detailed scope of work ───────────────────────────────────────────────
function scopeOfWorkPage(d: ReportData, pageNum: number): string {
  return `<div class="page interior">
    ${headerBar(d.companyName, "المقيّم المعتمد ونطاق العمل")}
    <div class="content">
      ${sectionTitle(1, "المقيّم المعتمد")}
      <div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">معتمد التقرير</div><div class="value">${esc(d.reportAuthorName)}</div></div>
        <div class="kv"><div class="label">رقم رخصة التقييم (رقم الصك)</div><div class="value">${esc(d.reportAuthorLicenseNo)}</div></div>
      </div></div>

      ${sectionTitle(2, "نطاق العمل")}
      <div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">العميل</div><div class="value">${esc(d.clientName)}</div></div>
        <div class="kv"><div class="label">اسم المفوض بطلب التقييم</div><div class="value">${esc(d.clientName)}</div></div>
        <div class="kv"><div class="label">المستخدمين الآخرين</div><div class="value">${esc(d.clientName)}</div></div>
        <div class="kv"><div class="label">العقار محل التقييم</div><div class="value">${esc(d.propertyTypeLabel)}</div></div>
        <div class="kv"><div class="label">الغرض من التقييم</div><div class="value">${esc(d.valuationPurposeLabel)}</div></div>
        <div class="kv"><div class="label">أساس القيمة</div><div class="value">${esc(d.valuationBasisLabel)}</div></div>
        <div class="kv"><div class="label">فرضية القيمة</div><div class="value">${esc(d.valuationHypothesisLabel)}</div></div>
        <div class="kv"><div class="label">الاستخدام المقصود</div><div class="value">يُستخدم التقرير لدعم إعداد التقارير المالية.</div></div>
        <div class="kv"><div class="label">تاريخ التكليف</div><div class="value">${esc(d.assignmentDate)}</div></div>
        <div class="kv"><div class="label">تاريخ المعاينة</div><div class="value">${esc(d.inspectionDate)}</div></div>
        <div class="kv"><div class="label">تاريخ التقييم (تاريخ القياس)</div><div class="value">${esc(d.evalDate)}</div></div>
        <div class="kv"><div class="label">تاريخ إصدار التقرير</div><div class="value">${esc(d.reportDate)}</div></div>
        <div class="kv"><div class="label">نوع التقرير</div><div class="value">تقرير سردي تفصيلي يراعي جميع التفاصيل المؤثرة في الأصل محل التقييم.</div></div>
        <div class="kv"><div class="label">طريقة التسليم</div><div class="value">خطاب رسمي بالبريد الإلكتروني الموضح في بيانات التواصل مع العميل.</div></div>
        <div class="kv"><div class="label">عملة التقييم</div><div class="value">تمّ التقييم وكافة الحسابات بالريال السعودي (﷼).</div></div>
      </div></div>

      ${sectionTitle(3, "أساس القيمة")}
      <div class="card"><div class="prose">القيمة العادلة هي السعر الذي يتم الحصول عليه من بيع أصل، أو يُدفع لتحويل التزام، في معاملة منظمة بين المشاركين في السوق بتاريخ القياس، وفق ما ورد في معايير التقييم الدولية السارية.</div></div>

      ${sectionTitle(4, "إقرار بالاستقلالية وعدم تضارب المصالح")}
      <div class="card"><div class="prose">${esc(d.independenceStatement)}</div></div>

      ${sectionTitle(5, "الاستعانة بأخصائي")}
      <div class="card"><div class="prose muted">لم يتم الاستعانة بأي أخصائي خارجي أثناء تنفيذ هذه المهمة؛ جميع إجراءات المعاينة وجمع البيانات والتحليل واستخلاص القيمة تمّت حصرًا بواسطة فريق التقييم الداخلي لدى ${esc(d.companyName)}.</div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── 4. Restrictions / disclaimers / assumptions / ESG / IVS compliance ─────
function disclaimersPage(d: ReportData, pageNum: number): string {
  return `<div class="page interior">
    ${headerBar(d.companyName, "القيود والإفصاحات والامتثال")}
    <div class="content">
      ${sectionTitle(1, "القيود على الاستخدام والنشر والتوزيع")}
      <div class="card"><div class="prose muted">أُعدّ هذا التقرير لأغراض التقييم المذكورة أعلاه فقط، وتبقى جميع الحقوق محفوظة لشركة ${esc(d.companyName)}. لا يجوز نسخ أو إعادة إنتاج أو توزيع أو نشر هذا التقرير كليًا أو جزئيًا بأي وسيلة إلا بعد الحصول على موافقة خطية مسبقة، ويقتصر استخدامه على الأطراف المصرّح لها.</div></div>

      ${sectionTitle(2, "إخلاء المسؤولية")}
      <div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">حقوق الملكية</div><div class="value">هذه الوثيقة ملك لشركة ${esc(d.companyName)}، ولا يجوز استخدامها لغير الغرض الذي أُعدّت له.</div></div>
        <div class="kv"><div class="label">هامش التذبذب في القيمة</div><div class="value">يصل هامش التذبذب في القيمة إلى ±10% تبعًا لظروف السوق الحالية.</div></div>
        <div class="kv"><div class="label">دراسة السوق</div><div class="value">أُجريت دراسة للسوق العقاري المحيط بالعقار باستخدام أقرب العقارات من حيث المواصفات والمساحات.</div></div>
        <div class="kv"><div class="label">تحديث المعلومات</div><div class="value">قد تتغيّر النتائج في حال توفر بيانات جديدة أو أكثر موثوقية تؤثر على القيمة.</div></div>
        <div class="kv" style="grid-column:1/-1;"><div class="label">الإفصاح عن المعلومات</div><div class="value">نؤكد أن التقرير يحتوي على معلومات صحيحة وفق معرفتنا، ولم يتم إخفاء أي معلومات جوهرية قد تؤثر على القيمة الحالية أو المستقبلية للعقار.</div></div>
      </div></div>

      ${sectionTitle(3, "الافتراضات والافتراضات الخاصة (إن وجدت)")}
      <div class="card"><div class="prose muted">تُعد الافتراضات أمورًا منطقية يمكن قبولها كحقيقة في سياق أعمال التقييم دون التحقق التفصيلي منها؛ وهي ضرورية لفهم التقييم. لم يتم رصد افتراضات خاصة تخرج عن الحقائق الفعلية القائمة في تاريخ التقييم.</div></div>

      ${sectionTitle(4, "العوامل البيئية والاجتماعية والحوكمة (ESG)")}
      <table class="card"><thead><tr><th>البُعد</th><th>التقييم</th></tr></thead>
      <tbody>
        <tr><td>بيئي (Environmental)</td><td>لا يوجد تأثير جوهري مباشر مرصود على نتيجة هذا التقييم.</td></tr>
        <tr><td>اجتماعي (Social)</td><td>لا يوجد تأثير جوهري مباشر مرصود على نتيجة هذا التقييم.</td></tr>
        <tr><td>حوكمة (Governance)</td><td>تم النظر في هذا البُعد كإطار لفهم التحديات والفرص المحيطة بعملية التقييم.</td></tr>
      </tbody></table>

      ${sectionTitle(5, "طبيعة عمل المقيّم وأي قيود عليه")}
      <div class="card"><div class="prose muted">لا يوجد.</div></div>

      ${sectionTitle(6, "جودة عملية التقييم والامتثال لمعايير IVS 100 / 105 / 106")}
      <div class="card"><div class="prose">تم توثيق ومراجعة مراحل التقييم داخليًا وفق نظام ضمان الجودة المعتمد لدى الشركة. يلتزم فريق التقييم بمبادئ النزاهة والموضوعية والكفاءة والعناية المهنية الواجبة الواردة في IVS 100، وتم اختيار نموذج التقييم ومنهجية التوثيق بما يتوافق مع متطلبات IVS 105 وIVS 106.</div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── 5. Fair value data hierarchy ────────────────────────────────────────────
function fairValueHierarchyPage(d: ReportData, pageNum: number): string {
  const rows = [
    {
      level: "المستوى الأول (Level 1)",
      note: "أسعار معلنة غير معدّلة في أسواق نشطة لأصول أو التزامات مطابقة يمكن الوصول إليها في تاريخ القياس.",
      inputs: "لا توجد أسعار معلنة مطابقة للأصل محل التقييم في سوق نشط.",
      classification: "لا ينطبق",
      source: "لا ينطبق",
      judgment: "لا توجد أسواق نشطة لأصول من هذا النوع، وبالتالي لم تُستخدم مدخلات مستوى أول.",
    },
    {
      level: "المستوى الثاني (Level 2)",
      note: "مدخلات بخلاف الأسعار المعلنة ضمن المستوى الأول، ويمكن رصدها بشكل مباشر أو غير مباشر.",
      inputs: "أسعار صفقات وعروض بيع لعقارات مماثلة في منطقة العقار، ومعدلات إيجارية وتكاليف إحلال منشورة.",
      classification: "مدخلات قابلة للملاحظة",
      source: "بيانات السوق، وزارة العدل، منصّات السوق العقاري، عروض أسعار المقاولين",
      judgment: "تم التحقق من ملاءمة هذه المدخلات ومقارنتها ببيانات سوقية مشابهة وتحليل اتجاهات الأسعار.",
    },
    {
      level: "المستوى الثالث (Level 3)",
      note: "مدخلات لا يمكن رصدها في السوق وتُمنح الأولوية الأدنى.",
      inputs: "لا ينطبق",
      classification: "مدخلات غير قابلة للملاحظة",
      source: "لا ينطبق",
      judgment: "لا ينطبق",
    },
  ];
  const cards = rows
    .map(
      (r) => `<div class="card compact"><div class="kv-grid cols2">
        <div class="kv" style="grid-column:1/-1;background:var(--blue-700);"><div class="value" style="color:#fff;">${esc(r.level)}</div></div>
        <div class="kv" style="grid-column:1/-1;"><div class="label">التوضيح وبيان المدخلات</div><div class="value">${esc(r.note)} ${esc(r.inputs)}</div></div>
        <div class="kv"><div class="label">التصنيف</div><div class="value">${esc(r.classification)}</div></div>
        <div class="kv"><div class="label">المصدر</div><div class="value">${esc(r.source)}</div></div>
        <div class="kv" style="grid-column:1/-1;"><div class="label">الحكم والتوثيق</div><div class="value">${esc(r.judgment)}</div></div>
      </div></div>`,
    )
    .join("");
  return `<div class="page interior">
    ${headerBar(d.companyName, "جدول التسلسل الهرمي للقيمة العادلة")}
    <div class="content"><div class="one-page-group">${sectionTitle(1, "جدول التسلسل الهرمي")}${cards}</div></div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

function searchScopePage(d: ReportData, pageNum: number): string {
  const sources = [
    "نظام المقيّمين المعتمدين ولائحته التنفيذية",
    "معايير التقييم الدولية IVS",
    "أسعار المقاولين والمطورين السائدة في السوق",
    "مؤشرات وزارة العدل العقارية",
    "المستندات المستلمة من العميل",
    "البيانات الجيومكانية الوطنية وأمانات المدن والمحافظات",
    "التطبيقات والمنصّات العقارية",
    "قاعدة بيانات " + d.companyName,
  ];
  const reliability = [
    { step: "١. جمع المعلومات", desc: "إجراء بحث ميداني للتحقق من المعلومات السوقية المتعلقة بالعقار، واستخدام مصادر حكومية موثوقة.", judgment: "موثوق" },
    { step: "٢. تقييم مصداقية المعلومات", desc: "مطابقة الغرض من التقييم وأهمية المعلومات المجمّعة مع خبرة المصدر واستقلاليته.", judgment: "موثوق" },
    { step: "٣. التحقق من المعلومات", desc: "مقارنة مستندات العميل (الصك، رخصة البناء، الرفع المساحي) مع بيانات المصادر الحكومية.", judgment: "تم التحقق" },
    { step: "٤. مصادر العقارات المقارنة", desc: "اختيار عقارات مقارنة من ذات المنطقة الجغرافية، متشابهة في الحجم والنوع والموقع مع الأصل محل التقييم.", judgment: "ملاءمة تم التحقق منها" },
  ];
  const steps = [
    { title: "جمع البيانات الأولية", desc: "جمع المعلومات وتحليل المستندات المرسلة من قبل العميل." },
    { title: "معاينة العقار وجمع معلومات السوق", desc: "معاينة العقار ميدانيًا وجمع معلومات السوق وأسعار المقارنات لعقارات مشابهة." },
    { title: "تحليل البيانات", desc: "تحليل معلومات السوق والمستندات تمهيدًا لتطبيق عمليات التقييم." },
    { title: "تطبيق أساليب التقييم", desc: "استخدام الأسلوب المناسب حسب نوع العقار وغرض التقييم وفرضية القيمة." },
    { title: "مراجعة التقرير وإصدار المسودة", desc: "مراجعة التقرير من قبل مقيّمين معتمدين وإصدار المسودة الأولى." },
    { title: "التقرير النهائي", desc: "إصدار التقرير النهائي وتسليمه وفقًا للمعايير المعتمدة." },
  ];
  const stepCards = steps
    .map(
      (s, i) => `<div class="process-step compact"><div class="badge">${i + 1}</div><div class="txt"><h4>${esc(s.title)}</h4><p>${esc(s.desc)}</p></div></div>`,
    )
    .join("");

  return `<div class="page interior">
    ${headerBar(d.companyName, "نطاق البحث ومصادر معلومات المقيّم")}
    <div class="content">
      ${sectionTitle(1, "مصادر المعلومات")}
      <div class="card"><div class="prose">${sources.map((s) => `• ${esc(s)}`).join("<br>")}</div></div>

      ${sectionTitle(2, "التأكد من موثوقية المعلومات المقدمة")}
      <table class="card"><thead><tr><th>الخطوة</th><th>الوصف</th><th>الحكم على الموثوقية</th></tr></thead>
      <tbody>${reliability.map((r) => `<tr><td>${esc(r.step)}</td><td style="text-align:right">${esc(r.desc)}</td><td>${esc(r.judgment)}</td></tr>`).join("")}</tbody></table>

      ${sectionTitle(3, "مراحل إعداد التقرير")}
      <div class="process-grid compact">${stepCards}</div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Process diagram (kept as its own page for now — still referenced by
// buildPageList; unused unless wired back in) ──────────────────────────────
function processPage(d: ReportData, pageNum: number): string {
  const steps = [
    { title: "جمع البيانات الأولية", desc: "جمع المعلومات وتحليل المستندات المرسلة من قبل العميل." },
    { title: "معاينة العقار وجمع معلومات السوق", desc: "معاينة العقار ميدانيًا وجمع معلومات السوق وأسعار المقارنات لعقارات مشابهة." },
    { title: "تحليل البيانات", desc: "تحليل معلومات السوق والمستندات تمهيدًا لتطبيق عمليات التقييم." },
    { title: "تطبيق أساليب التقييم", desc: "استخدام الأسلوب المناسب حسب نوع العقار وغرض التقييم وفرضية القيمة." },
    { title: "مراجعة التقرير وإصدار المسودة", desc: "مراجعة التقرير من قبل مقيّمين معتمدين وإصدار المسودة الأولى." },
    { title: "التقرير النهائي", desc: "إصدار التقرير النهائي وتسليمه وفقًا للمعايير المعتمدة." },
  ];
  const cards = steps
    .map((s, i) => `<div class="process-step"><div class="badge">${i + 1}</div><div class="txt"><h4>${esc(s.title)}</h4><p>${esc(s.desc)}</p></div></div>`)
    .join("");
  return `<div class="page interior">
    ${headerBar(d.companyName, "منهجية العمل")}
    <div class="content">${sectionTitle(1, "مراحل إعداد التقرير")}<div class="process-grid">${cards}</div></div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Property details — now opens with an inline section banner instead of
// a preceding standalone divider page ───────────────────────────────────────
function propertyDetailsPage(d: ReportData, pageNum: number): string {
  const boundaryRows = d.boundaries
    .map(
      (b, i) =>
        `<tr><td>${esc(b.side)}</td><td>${esc(b.description)}</td><td>${esc(b.length)}</td>${
          i === 0 ? `<td rowspan="4" style="vertical-align:middle">مساحة الأرض<br><strong>${esc(d.landSpace)} م²</strong></td>` : ""
        }</tr>`,
    )
    .join("");

  const hasLicense = d.buildingLicenseNumber !== "—" || d.buildingLicenseDate !== "—";
  const licenseBlock = hasLicense
    ? `<div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">رقم رخصة البناء</div><div class="value">${esc(d.buildingLicenseNumber)}</div></div>
        <div class="kv"><div class="label">تاريخ رخصة البناء</div><div class="value">${esc(d.buildingLicenseDate)}</div></div>
      </div></div>`
    : `<div class="card"><div class="prose muted">تم احتساب المسطحات وعمر العقار تقديريًا. يُلزم قرار مساحي رسمي للتأكد والمطابقة في حال عدم توفر رخصة بناء أو رقم قطعة/مخطط.</div></div>`;

  const s = d.services;

  return `<div class="page interior">
    ${headerBar(d.companyName, "تفاصيل موقع العقار")}
    <div class="content">
      ${sectionBanner("تفاصيل العقار", "موقع العقار، حالته، حدوده، وتشطيباته")}
      ${sectionTitle(1, "تفاصيل موقع العقار")}
      <div class="card"><div class="kv-grid">
        <div class="kv"><div class="label">المدينة</div><div class="value">${esc(d.city)}</div></div>
        <div class="kv"><div class="label">الحي</div><div class="value">${esc(d.neighborhood)}</div></div>
        <div class="kv"><div class="label">رقم القطعة</div><div class="value">${esc(d.parcelNumber)}</div></div>
        <div class="kv"><div class="label">رقم الصك</div><div class="value">${esc(d.deedNumber)}</div></div>
        <div class="kv"><div class="label">اسم المالك</div><div class="value">${esc(d.ownerName)}</div></div>
        <div class="kv"><div class="label">استخدام العقار</div><div class="value">${esc(d.propertyUse)}</div></div>
        <div class="kv"><div class="label">الإحداثيات</div><div class="value">N ${esc(d.lat)} / E ${esc(d.lng)}</div></div>
      </div></div>

      ${sectionTitle(2, "حالة العقار")}
      <div class="checkline">
        ${check(d.buildingConditionLabel === "جديد", "جديد")}
        ${check(d.buildingConditionLabel === "مستخدم", "مستخدم")}
        ${check(d.buildingConditionLabel === "تحت الإنشاء", "تحت الإنشاء")}
        ${check(d.buildingConditionLabel === "اخرى", "اخرى")}
        <span style="font-size:12px;color:var(--gray-600);align-self:center;">نسبة اكتمال البناء: ${esc(d.buildingCompletionPct)}</span>
      </div>

      ${sectionTitle(3, "حدود وأطوال العقار")}
      <table class="card"><thead><tr><th>الجهة</th><th>الوصف</th><th>الطول</th><th>المساحة (م²)</th></tr></thead><tbody>${boundaryRows}</tbody></table>

      ${sectionTitle(4, "معلومات رخصة البناء")}
      ${licenseBlock}

      ${sectionTitle(5, "تصنيف مستوى تشطيبات البناء")}
      <div class="checkline">
        ${check(d.finishLevelLabel === "تشطيب فاخر", "تشطيب فاخر")}
        ${check(d.finishLevelLabel === "تشطيب متوسط", "تشطيب متوسط")}
        ${check(d.finishLevelLabel === "تشطيب عادي", "تشطيب عادي")}
        ${check(d.finishLevelLabel === "بدون تشطيب", "بدون تشطيب")}
      </div>

      ${sectionTitle(6, "الخدمات والمرافق المتوفرة")}
      <div class="checkline">
        ${check(!!s.electricity, `الكهرباء (عدادات: ${esc(s.electricityMetersCount)})`)}
        ${check(!!s.water, `المياه (عدادات: ${esc(s.waterMetersCount)})`)}
        ${check(!!s.sanitaryDrainage, "الصرف الصحي")}
        ${check(!!s.telephoneLine, "الهاتف")}
      </div>

      ${sectionTitle(7, "المحيط المؤثر للعقار")}
      <div class="checkline">
        ${d.surroundingEnvironment.length ? d.surroundingEnvironment.map((e) => check(true, e)).join("") : `<span style="font-size:12px;color:var(--gray-600);">لا توجد بيانات</span>`}
      </div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Finishing + services + surrounding environment ──────────────────────────
function finishingServicesPage(d: ReportData, pageNum: number): string {
  const s = d.services;
  return `<div class="page interior">
    ${headerBar(d.companyName, "التشطيبات والخدمات والمحيط")}
    <div class="content">
      ${sectionTitle(1, "تصنيف مستوى تشطيبات البناء")}
      <div class="checkline">
        ${check(d.finishLevelLabel === "تشطيب فاخر", "تشطيب فاخر")}
        ${check(d.finishLevelLabel === "تشطيب متوسط", "تشطيب متوسط")}
        ${check(d.finishLevelLabel === "تشطيب عادي", "تشطيب عادي")}
        ${check(d.finishLevelLabel === "بدون تشطيب", "بدون تشطيب")}
      </div>

      ${sectionTitle(2, "الخدمات والمرافق المتوفرة")}
      <div class="checkline">
        ${check(!!s.electricity, `الكهرباء (عدادات: ${esc(s.electricityMetersCount)})`)}
        ${check(!!s.water, `المياه (عدادات: ${esc(s.waterMetersCount)})`)}
        ${check(!!s.sanitaryDrainage, "الصرف الصحي")}
        ${check(!!s.telephoneLine, "الهاتف")}
      </div>

      ${sectionTitle(3, "المحيط المؤثر للعقار")}
      <div class="checkline">
        ${d.surroundingEnvironment.length ? d.surroundingEnvironment.map((e) => check(true, e)).join("") : `<span style="font-size:12px;color:var(--gray-600);">لا توجد بيانات</span>`}
      </div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Methodology — opens the "valuation method" part with an inline banner ──
function methodologyPage(d: ReportData, pageNum: number): string {
  const a = d.approachesUsed;
  const rows = [
    {
      method: "أسلوب السوق — طريقة المقارنة",
      used: a.marketComparison,
      desc: "تستند إلى مقارنة العقار المراد تقييمه بعقارات مشابهة بيعت أو عُرضت مؤخرًا في ذات المنطقة، مع تعديل الأسعار وفق الفروقات بين العقارات.",
      why: "يوفر تقديرًا موضوعيًا مستندًا إلى السوق الفعلي، ودقة نسبية عند توفر معاملات مماثلة حديثة.",
    },
    {
      method: "أسلوب التكلفة — طريقة الإحلال",
      used: a.cost,
      desc: "تقدير تكلفة بناء عقار جديد بذات المواصفات، ثم تعديل هذه التكلفة وفق حالة العقار (الإهلاك) للوصول إلى القيمة الحالية.",
      why: "مناسب للعقارات التي يصعب العثور على معاملات مقارنة لها، ومفيد لتقييم مكوّنات البناء بشكل مستقل عن الأرض.",
    },
    {
      method: "أسلوب الدخل — رسملة الدخل",
      used: a.incomeCapitalization || a.income,
      desc: "تحويل صافي الدخل التشغيلي المتوقع للعقار إلى قيمة حالية باستخدام معدل رسملة مناسب.",
      why: "يُستخدم للعقارات المدرّة لدخل ثابت وواضح يمكن التحقق منه.",
    },
  ];
  const cards = rows
    .map(
      (r) => `<div class="card"><div class="kv-grid cols2">
      <div class="kv" style="grid-column:1/-1; background:${r.used ? "var(--blue-700)" : "var(--gray-400)"};"><div class="value" style="color:#fff;">${esc(r.method)} ${r.used ? "" : "(لم يُستخدم)"}</div></div>
      <div class="kv"><div class="label">الوصف وآلية العمل</div><div class="value">${esc(r.desc)}</div></div>
      <div class="kv"><div class="label">أسباب الاستخدام</div><div class="value">${esc(r.why)}</div></div>
    </div></div>`,
    )
    .join("");
  return `<div class="page interior">
    ${headerBar(d.companyName, "أسلوب أو طريقة التقييم المستخدمة")}
    <div class="content">
      ${sectionBanner("أسلوب التقييم", "المبررات، منهجية العمل، وتفاصيل كل أسلوب")}
      ${sectionTitle(1, "مبررات اختيار الأساليب")}
      ${cards}
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Market approach: comparables + settlement table on one page ────────────
function marketApproachPage(d: ReportData, pageNum: number): string {
  const compRows = d.comparisons.length
    ? d.comparisons
        .map(
          (c, i) =>
            `<tr><td>المقارنة ${i + 1}</td><td>${esc(c.propertyType)}</td><td>${esc(c.comparisonKind)}</td><td>${esc(c.landSpace)}</td><td>${esc(c.evalDate)}</td><td>${esc(c.price)}</td><td>${esc(c.total)}</td><td>${esc(c.source)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="8">لا توجد مقارنات</td></tr>`;

  let settlementBlock = "";
  if (d.settlementColumns.length) {
    const headerCols = d.settlementColumns.map((c) => `<th>${esc(c.header)}</th>`).join("");
    const baseRow = `<tr><td>سعر المتر</td>${d.settlementColumns.map((c) => `<td>${esc(c.base)}</td>`).join("")}</tr>`;
    const adjRows = d.settlementRows.map((r) => `<tr><td>${esc(r.title)}</td>${r.colAdj.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("");
    const weightRow = `<tr><td>المرجّح الموزون</td>${d.settlementWeights.map((w) => `<td>${esc(w)}</td>`).join("")}</tr>`;
    settlementBlock = `${sectionTitle(2, "التسويات")}
      <table class="card"><thead><tr><th>البند</th>${headerCols}</tr></thead><tbody>${baseRow}${adjRows}${weightRow}</tbody></table>
      <div class="highlight-box"><div>
        <div class="label">صافي سعر المتر بعد الوزن النسبي للتسويات</div>
        <div class="amount"><span class="cur">﷼</span>${esc(d.netMeterPrice)}</div>
      </div></div>`;
  }

  return `<div class="page interior">
    ${headerBar(d.companyName, "التقييم بأسلوب السوق")}
    <div class="content">
      ${sectionTitle(1, "العقارات المقارنة")}
      <table class="card"><thead><tr><th>البند</th><th>نوع العقار</th><th>نوع العملية</th><th>المساحة</th><th>تاريخ العملية</th><th>سعر المتر</th><th>الإجمالي</th><th>المصدر</th></tr></thead><tbody>${compRows}</tbody></table>
      ${settlementBlock}
      <p class="prose muted" style="padding:8px 0 0 0;">تم إجراء عملية التسويات والتعديلات وفق ما هو متعارف عليه في السوق، واستنادًا إلى ما هو معروض بالسوق، مع تقديرها كنسب مئوية بناءً على خبرة المقيّم.</p>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Cost approach: building breakdown + replacement calc ───────────────────
function costApproachPage(d: ReportData, pageNum: number): string {
  const breakdownRows = d.buildingBreakdown
    .map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(b.area)}</td><td>${esc(b.unitPrice)}</td><td>${esc(b.total)}</td></tr>`)
    .join("");
  const s = d.replacementSummary;
  return `<div class="page interior">
    ${headerBar(d.companyName, "التقييم بأسلوب التكلفة")}
    <div class="content">
      ${sectionTitle(1, "وصف مسطحات المبنى")}
      <table class="card"><thead><tr><th>الاستخدام</th><th>المساحة</th><th>سعر المتر</th><th>الإجمالي</th></tr></thead>
        <tbody>${breakdownRows}<tr><td colspan="3" style="font-weight:700;">إجمالي مسطحات البناء</td><td style="font-weight:700;">${esc(d.totalBuiltArea)}</td></tr></tbody></table>

      ${sectionTitle(2, "أسلوب التكلفة (طريقة الإحلال)")}
      <div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">مساحة المبنى</div><div class="value">${esc(s.totalArea)}</div></div>
        <div class="kv"><div class="label">القيمة المباشرة الإجمالية</div><div class="value">${esc(s.directTotal)}</div></div>
        <div class="kv"><div class="label">القيمة المهلكة للمباني (صافي)</div><div class="value">${esc(s.netBuildings)}</div></div>
        <div class="kv"><div class="label">قيمة الأرض</div><div class="value">${esc(s.netLandPrice)}</div></div>
        <div class="kv"><div class="label">صافي سعر المتر</div><div class="value">${esc(s.netMeterPrice)}</div></div>
      </div></div>

      <div class="highlight-box"><div>
        <div class="label">القيمة العادلة بأسلوب التكلفة</div>
        <div class="amount"><span class="cur">﷼</span>${esc(s.landBuildTotal)}</div>
      </div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Investment approach (income capitalization / DCF / residual / rental) ──
function investmentApproachPage(d: ReportData, pageNum: number): string {
  const rows = d.investmentApproach.rows.length
    ? d.investmentApproach.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join("")
    : `<tr><td colspan="2">لا توجد بنود مفصّلة</td></tr>`;

  const compsBlock = d.investmentApproach.marketComps.length
    ? `${sectionTitle(2, "طريقة الاستخلاص من السوق (تحليل معدل الرسملة)")}
      <table class="card"><thead><tr><th>البند</th><th>المبنى / الوحدة</th><th>دخل العقار</th><th>قيمة العقار</th><th>معدل الرسملة</th><th>ملاحظات</th></tr></thead>
      <tbody>${d.investmentApproach.marketComps
        .map(
          (c) =>
            `<tr><td>${esc(c.entryTitle)}</td><td>${esc(c.title)}</td><td>${esc(c.income)}</td><td>${esc(c.propertyValue)}</td><td>${esc(c.capRate)}</td><td>${esc(c.notes)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";

  return `<div class="page interior">
    ${headerBar(d.companyName, "التقييم بأسلوب الدخل")}
    <div class="content">
      ${sectionTitle(1, "رسملة الدخل / التدفقات النقدية")}
      <p class="prose" style="padding:0 0 10px 0;">تم تطبيق أسلوب الدخل نظرًا لتوفر بيانات إيجارية أو تدفقات نقدية موثوقة تخص العقار محل التقييم.</p>
      <table class="card"><thead><tr><th>البند</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table>

      ${compsBlock}

      <div class="highlight-box"><div>
        <div class="label">القيمة العادلة بأسلوب الدخل</div>
        <div class="amount"><span class="cur">﷼</span>${esc(d.investmentApproach.total)}</div>
      </div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Final opinion: weighting + value + consolidated sign-off ───────────────
// Previously split across "المشاركون في إعداد التقرير" (inspector/preparer),
// "توقيعات المقيّمين المعتمدين والعميل" (authors + client), and "اعتماد
// المقيّم المعتمد" (lead, again) — the lead appraiser's name/membership was
// printed twice. Now: one signature grid with everyone, plus a single
// closing approval stamp.
function finalOpinionPage(d: ReportData, pageNum: number): string {
  const weightRows = d.methodWeights
    .map((m) => `<tr><td>${esc(m.method)}</td><td>${esc(m.value)}</td><td>${esc(m.weightPct)}</td><td>${esc(m.contribution)}</td></tr>`)
    .join("");

  const authorSigCards = d.authorSignatures.length
    ? d.authorSignatures.map((a) => sigCard(a.title, a.name, a.membership, a.signatureImageDataUrl)).join("")
    : "";
  const clientSigCard = sigCard("توقيع العميل", d.clientName);
  const inspectorSigCard = sigCard("المعاين", d.inspectorName);
  const preparerSigCard = sigCard("تحليل البيانات وإعداد التقرير", d.preparerName);

  return `<div class="page interior">
    ${headerBar(d.companyName, "الرأي النهائي للقيمة")}
    <div class="content">
      ${sectionTitle(1, "الترجيح بين الأساليب")}
      <p class="prose" style="padding:0 0 10px 0;">عند تطبيق أساليب التقييم بشكل منفصل يمكن أن تنتج قيم مختلفة للعقار؛ لذا يُستخدم الترجيح للوصول إلى تقدير أكثر دقة وواقعية للقيمة العادلة.</p>
      <table class="card"><thead><tr><th>الأسلوب</th><th>القيمة</th><th>الوزن النسبي</th><th>المساهمة</th></tr></thead><tbody>${weightRows}</tbody></table>

      ${sectionTitle(2, "القيمة العادلة بعد الترجيح")}
      <div class="highlight-box"><div>
        <div class="label">القيمة رقمًا (ريال سعودي)</div>
        <div class="amount"><span class="cur">﷼</span>${esc(d.finalAssetValue)}</div>
        <div class="written">${esc(d.fairValueWritten)}</div>
      </div></div>

      ${sectionTitle(3, "التوقيعات واعتماد التقرير")}
      <div class="signature-grid">
        ${inspectorSigCard}
        ${preparerSigCard}
        ${authorSigCards}
        ${clientSigCard}
      </div>

      <div class="final-approval">
        <div>
          <div class="tag">اعتماد نهائي — المقيّم المعتمد</div>
          <div class="name">${esc(d.leadAppraiserName)}</div>
          <div class="meta">${esc(d.leadAppraiserTitle)} — رقم العضوية ${esc(d.leadAppraiserMembership)} — تاريخ التقرير: ${esc(d.reportDate)}</div>
        </div>
        ${
          d.leadAppraiserSignatureDataUrl
            ? `<div style="width:110px; height:64px; border:1px solid var(--line); border-radius:10px; padding:2px;"><img src="${d.leadAppraiserSignatureDataUrl}" style="width:100%; height:100%; object-fit:contain;" /></div>`
            : `<div style="width:110px; height:64px; border:1px dashed var(--line); border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--gray-400);">الختم والتوقيع</div>`
        }
      </div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Maps — opens the "appendices" part with an inline banner ───────────────
function mapsPage(d: ReportData, pageNum: number): string {
  const mapBlock = d.mapImageDataUri
    ? `<img class="map-img" src="${d.mapImageDataUri}" />`
    : `<p class="prose muted">تعذّر تحميل صورة الخريطة لهذا العقار وقت إعداد التقرير.</p>`;
  return `<div class="page interior">
    ${headerBar(d.companyName, "الخرائط")}
    <div class="content">
      ${sectionBanner("الملحقات", "الخرائط، الصور، والمرفقات المرفوعة")}
      ${sectionTitle(1, "موقع العقار")}
      <div class="card">${mapBlock}</div>
      <div class="card"><div class="kv-grid cols2">
        <div class="kv"><div class="label">خط العرض (N)</div><div class="value">${esc(d.lat)}</div></div>
        <div class="kv"><div class="label">خط الطول (E)</div><div class="value">${esc(d.lng)}</div></div>
      </div></div>
    </div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// ── Property images: 3-per-row grid, paginated, numbered captions ──────────
function imagesPages(d: ReportData, startPageNum: number): string {
  if (!d.images.length) return "";
  const PER_PAGE = 15;
  const chunks: (typeof d.images)[] = [];
  for (let i = 0; i < d.images.length; i += PER_PAGE) chunks.push(d.images.slice(i, i + PER_PAGE));

  return chunks
    .map((chunk, idx) => {
      const cells = chunk
        .map(
          (img, i) =>
            `<figure><img src="${img.dataUri}" /><figcaption>${idx * PER_PAGE + i + 1}. ${esc(img.name)}</figcaption></figure>`,
        )
        .join("");
      return `<div class="page interior">
        ${headerBar(d.companyName, `الصور والملحقات${chunks.length > 1 ? ` (${idx + 1}/${chunks.length})` : ""}`)}
        <div class="content">${sectionTitle(1, "صور العقار")}<div class="image-grid">${cells}</div></div>
        ${footerBar(d.companyName, startPageNum + idx)}
      </div>`;
    })
    .join("");
}

// ── Attachments cover + index ───────────────────────────────────────────────
function attachmentsCoverPage(d: ReportData, pageNum: number): string {
  const total = d.pdfAttachments.length + d.imageAttachments.length + d.otherAttachments.length;
  if (!total) return "";
  const list = [
    ...d.pdfAttachments.map((a) => `${a.name} (${a.pageCount ?? "؟"} صفحة)`),
    ...d.imageAttachments.map((a) => `${a.name} (صورة/مستند)`),
    ...d.otherAttachments.map((a) => `${a.name} (${a.mimeType})`),
  ];
  return `<div class="page interior">
    ${headerBar(d.companyName, "المرفقات")}
    <div class="content"><div class="attach-cover">
      <h2>المرفقات (${total})</h2>
      <p>الصفحات التالية تحتوي على المستندات والمرفقات المرفوعة مع هذه المعاملة (صك الملكية، شهادات التسجيل، وغيرها)، كل مرفق بصفحاته الكاملة.</p>
      <div style="text-align:right; margin-top:20px; max-width:420px;">${list.map((l) => `<div style="font-size:11.5px; padding:6px 0; border-bottom:1px solid var(--line);">${esc(l)}</div>`).join("")}</div>
    </div></div>
    ${footerBar(d.companyName, pageNum)}
  </div>`;
}

// Image attachments (deed scans, registration certs, etc.) — one full page each.
function imageAttachmentPages(d: ReportData, startPageNum: number): string {
  if (!d.imageAttachments.length) return "";
  return d.imageAttachments
    .map(
      (img, i) => `<div class="page interior">
      ${headerBar(d.companyName, esc(img.name))}
      <div class="content" style="display:flex;align-items:center;justify-content:center;min-height:calc(100% - 80px);">
        <img src="${img.dataUri}" style="max-width:100%; max-height:900px; object-fit:contain;" />
      </div>
      ${footerBar(d.companyName, startPageNum + i)}
    </div>`,
    )
    .join("");
}

function thankYouPage(d: ReportData): string {
  return `<div class="page thankyou">
    <div style="position:absolute; top:52px; right:56px; left:56px; display:flex; align-items:center; gap:12px;">
      <div class="brand-mark">S</div><div class="brand-name">${esc(d.companyName)}</div>
    </div>
    <h1>شكرًا لكم</h1>
  </div>`;
}

// ── Page plan ────────────────────────────────────────────────────────────
// Two-pass approach: `planPages()` walks the exact same conditional
// inclusion logic as the render pass below, but only produces a lightweight
// list of { key, title, pageCount } — enough to assign real page numbers
// and build the TOC before any HTML is generated. Both passes MUST stay in
// sync; keep them next to each other if you add/remove a section.
type PlannedPage = { key: string; title: string; pageCount: number };

function planPages(d: ReportData): PlannedPage[] {
  const plan: PlannedPage[] = [];
  plan.push({ key: "certification", title: "ملخص التقييم", pageCount: 1 });
  plan.push({ key: "scope", title: "المقيّم المعتمد ونطاق العمل", pageCount: 1 });
  plan.push({ key: "disclaimers", title: "القيود والإفصاحات والامتثال", pageCount: 1 });
  plan.push({ key: "hierarchy", title: "جدول التسلسل الهرمي للقيمة العادلة", pageCount: 1 });
  plan.push({ key: "search", title: "نطاق البحث ومصادر معلومات المقيّم", pageCount: 1 });
  plan.push({ key: "property", title: "تفاصيل العقار", pageCount: 1 });
  plan.push({ key: "methodology", title: "أسلوب التقييم", pageCount: 1 });
  if (d.comparisons.length || d.settlementColumns.length) plan.push({ key: "market", title: "التقييم بأسلوب السوق", pageCount: 1 });
  if (d.buildingBreakdown.length) plan.push({ key: "cost", title: "التقييم بأسلوب التكلفة", pageCount: 1 });
  if (d.investmentApproach.used) plan.push({ key: "investment", title: "التقييم بأسلوب الدخل", pageCount: 1 });
  plan.push({ key: "opinion", title: "الرأي النهائي للقيمة", pageCount: 1 });
  plan.push({ key: "maps", title: "الملحقات — الخرائط", pageCount: 1 });
  if (d.images.length) plan.push({ key: "images", title: "الصور والملحقات", pageCount: Math.ceil(d.images.length / 15) });
  const hasAttachments = d.pdfAttachments.length + d.imageAttachments.length + d.otherAttachments.length > 0;
  if (hasAttachments) plan.push({ key: "attachments", title: "المرفقات", pageCount: 1 + d.imageAttachments.length });
  return plan;
}

export function renderReportHtml(d: ReportData): string {
  const plan = planPages(d);

  // Resolve page numbers: cover = unnumbered, TOC = page 2, content starts
  // at page 3.
  let cursor = 3;
  const tocEntries = plan.map((p) => {
    const entry = { title: p.title, page: cursor };
    cursor += p.pageCount;
    return entry;
  });

  const pages: string[] = [];
  let pageNum = 3;

  pages.push(coverPage(d));
  pages.push(tocPage(d, 2, tocEntries));

  pages.push(certificationSummaryPage(d, pageNum++));
  pages.push(scopeOfWorkPage(d, pageNum++));
  pages.push(disclaimersPage(d, pageNum++));
  pages.push(fairValueHierarchyPage(d, pageNum++));
  pages.push(searchScopePage(d, pageNum++));

  pages.push(propertyDetailsPage(d, pageNum++));

  pages.push(methodologyPage(d, pageNum++));
  if (d.comparisons.length || d.settlementColumns.length) pages.push(marketApproachPage(d, pageNum++));
  if (d.buildingBreakdown.length) pages.push(costApproachPage(d, pageNum++));
  if (d.investmentApproach.used) pages.push(investmentApproachPage(d, pageNum++));
  pages.push(finalOpinionPage(d, pageNum++));

  pages.push(mapsPage(d, pageNum++));

  const imgPages = imagesPages(d, pageNum);
  if (imgPages) {
    pages.push(imgPages);
    pageNum += Math.ceil(d.images.length / 15);
  }

  const hasAttachments = d.pdfAttachments.length + d.imageAttachments.length + d.otherAttachments.length > 0;
  if (hasAttachments) {
    pages.push(attachmentsCoverPage(d, pageNum++));
  }
  const imgAttachPages = imageAttachmentPages(d, pageNum);
  if (imgAttachPages) {
    pages.push(imgAttachPages);
    pageNum += d.imageAttachments.length;
  }
  // Real PDF attachments are merged in after this HTML render, via pdf-lib,
  // in transactions-pdf-html.service.ts.

  pages.push(thankYouPage(d));

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير تقييم عقاري</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLES}</style></head>
<body>${pages.join("\n")}</body></html>`;
}
