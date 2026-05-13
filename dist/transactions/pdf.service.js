"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsPdfService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const transactions_model_1 = require("./transactions.model");
const pdfkit_1 = __importDefault(require("pdfkit"));
const VALUATION_PURPOSES = {
    "1": "التمويل",
    "2": "الشراء",
    "3": "البيع",
    "4": "الرهن",
    "5": "محاسبة",
    "6": "إفلاس",
    "7": "استحواذ",
    "8": "التقرير المالي",
    "9": "الضرائب",
    "10": "الأغراض التأمينية",
    "11": "تقاضي",
    "12": "أغراض داخلية",
    "13": "نزع الملكية",
    "14": "نقل",
    "15": "ورث",
    "16": "اخرى",
    "17": "توزيع تركه",
    "18": "البيع القسري",
    "19": "معرفة القيمة السوقية",
    "20": "معرفة القيمة الإيجارية",
    "21": "التصفية",
    "50": "أغراض إستثمارية",
    "54": "التعويض",
};
const VALUATION_BASES = {
    "1": "القيمة السوقية",
    "2": "القيمة الاستثمارية",
    "3": "القيمة المنصفة",
    "4": "قيمة التصفية",
    "5": "القيمة التكاملية",
    "6": "الايجار السوقي",
    "7": "القيمة السوقية / قيمة الايجار السوقي",
    "8": "القيمة العادلة",
    "10": "الإدراج في القوائم المالية",
};
const OWNERSHIP_TYPES = {
    "1": "الملكية المطلقة",
    "2": "الملكية المشروطة",
    "3": "الملكية المقيدة",
    "4": "ملكية مدى الحياة",
    "5": "منفعة",
    "6": "مشاع",
    "7": "ملكية مرهونة",
};
const VALUATION_HYPOTHESES = {
    "1": "الاستخدام الحالي",
    "2": "الاستخدام الأعلى والأفضل",
    "3": "التصفية المنظمة",
    "4": "البيع القسري",
};
const PROPERTY_TYPES = {
    "1": "أرض",
    "2": "شقة",
    "3": "فيلا سكنية",
    "4": "عمارة",
    "5": "إستراحة",
    "6": "مزرعة",
    "7": "مستودع",
    "9": "محل تجاري",
    "10": "دور",
    "21": "أرض سكنية",
    "22": "أرض تجارية",
    "24": "فندق",
    "28": "مبنى تجاري",
    "67": "عمارة سكنية",
};
const REGIONS = {
    "1": "منطقة الرياض",
    "2": "منطقة مكة المكرمة",
    "3": "منطقة المدينة المنورة",
    "4": "منطقة القصيم",
    "5": "المنطقة الشرقية",
    "6": "منطقة عسير",
    "7": "منطقة تبوك",
    "8": "منطقة حائل",
    "9": "منطقة الحدود الشمالية",
    "10": "منطقة جازان",
    "11": "منطقة نجران",
    "12": "منطقة الباحة",
    "13": "منطقة الجوف",
};
const BUILDING_STATES = {
    "10001": "جديد",
    "10002": "مستخدم",
    "10003": "تحت الإنشاء",
    "10004": "اخرى",
};
const FINISH_LEVELS = {
    "23": "تشطيب فاخر",
    "24": "تشطيب متوسط",
    "25": "تشطيب عادي",
    "10006": "بدون تشطيب",
};
const BUILD_QUALITY = {
    "44": "ممتاز",
    "45": "جيد جداً",
    "46": "ردئ",
    "10058": "جيد",
};
const COLORS = {
    primary: "#1a6fc4",
    primaryDark: "#1558a0",
    accent: "#0f766e",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    border: "#e2e8f0",
    text: "#1e293b",
    textMuted: "#64748b",
    green: "#16a34a",
    greenLight: "#f0fdf4",
    amber: "#d97706",
    red: "#dc2626",
    sectionHeader: "#1e3a5f",
    tableHeaderBg: "#1a6fc4",
    rowEven: "#ffffff",
    rowOdd: "#f8fafc",
    totalRow: "#e0edff",
    finalRow: "#bbf7d0",
    weightRow: "#fef9c3",
    contributionRow: "#fde68a",
};
function parseNum(v) {
    if (!v)
        return 0;
    return parseFloat(String(v).replace(/,/g, "")) || 0;
}
function fmt(n, decimals = 2) {
    if (!isFinite(n))
        return "—";
    return n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
        ]
        : [0, 0, 0];
}
let TransactionsPdfService = class TransactionsPdfService {
    async generatePdf(id, res) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException("المعاملة غير موجودة");
        const db = await (0, mongodb_2.getMongoDb)();
        const tx = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!tx)
            throw new common_1.NotFoundException("المعاملة غير موجودة");
        const ev = { ...(0, transactions_model_1.emptyEvalData)(), ...(tx.evalData ?? {}) };
        const bl = {};
        for (const [, entry] of Object.entries(tx.templateFieldValues ?? {})) {
            if (entry?.label)
                bl[entry.label] = entry.value ?? "";
        }
        const compRows = (ev.comparisonRows ?? []).filter((r) => r.inReport !== false);
        const n = compRows.length;
        const doc = new pdfkit_1.default({
            size: "A4",
            margins: { top: 40, bottom: 40, left: 30, right: 30 },
            info: {
                Title: `تقرير التقييم - ${tx.assignmentNumber ?? id}`,
                Author: "نظام التقييم العقاري",
                Subject: "تقرير تقييم عقاري",
                Creator: "نظام التقييم",
            },
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="valuation-${id}.pdf"`);
        doc.pipe(res);
        const PAGE_W = doc.page.width - 60;
        const LEFT = 30;
        const fillRect = (x, y, w, h, color) => {
            const [r, g, b] = hexToRgb(color);
            doc.save().rect(x, y, w, h).fill([r, g, b]).restore();
        };
        const strokeRect = (x, y, w, h, color, lw = 0.5) => {
            const [r, g, b] = hexToRgb(color);
            doc
                .save()
                .lineWidth(lw)
                .rect(x, y, w, h)
                .stroke([r, g, b])
                .restore();
        };
        const textColor = (color) => {
            const [r, g, b] = hexToRgb(color);
            doc.fillColor([r, g, b]);
        };
        const drawSectionHeader = (title, y) => {
            fillRect(LEFT, y, PAGE_W, 26, COLORS.primary);
            textColor("#ffffff");
            doc.font("Helvetica-Bold").fontSize(11);
            doc.text(title, LEFT, y + 7, {
                width: PAGE_W,
                align: "right",
            });
            return y + 30;
        };
        const drawSubHeader = (title, y) => {
            fillRect(LEFT, y, PAGE_W, 22, COLORS.sectionHeader);
            textColor("#ffffff");
            doc.font("Helvetica-Bold").fontSize(10);
            doc.text(title, LEFT, y + 6, { width: PAGE_W, align: "right" });
            return y + 26;
        };
        const drawField = (label, value, x, y, w) => {
            const h = 32;
            fillRect(x, y, w, h, COLORS.surfaceAlt);
            strokeRect(x, y, w, h, COLORS.border);
            textColor(COLORS.textMuted);
            doc.font("Helvetica").fontSize(8);
            doc.text(label, x + 4, y + 4, { width: w - 8, align: "right" });
            textColor(COLORS.text);
            doc.font("Helvetica-Bold").fontSize(9);
            doc.text(value || "—", x + 4, y + 14, { width: w - 8, align: "right" });
            return y + h + 4;
        };
        const drawTwoFields = (label1, value1, label2, value2, y) => {
            const half = (PAGE_W - 4) / 2;
            drawField(label2, value2, LEFT, y, half);
            drawField(label1, value1, LEFT + half + 4, y, half);
            return y + 36;
        };
        const drawThreeFields = (items, y) => {
            const third = (PAGE_W - 8) / 3;
            for (let i = 0; i < Math.min(items.length, 3); i++) {
                const x = LEFT + (2 - i) * (third + 4);
                drawField(items[i][0], items[i][1], x, y, third);
            }
            return y + 36;
        };
        fillRect(LEFT, 40, PAGE_W, 70, COLORS.primary);
        fillRect(LEFT, 40, 6, 70, "#f59e0b");
        textColor("#ffffff");
        doc.font("Helvetica-Bold").fontSize(18);
        doc.text("تقرير التقييم العقاري", LEFT, 52, {
            width: PAGE_W,
            align: "right",
        });
        doc.font("Helvetica").fontSize(10);
        doc.text(`رقم التكليف: ${tx.assignmentNumber ?? "—"}  |  التاريخ: ${tx.assignmentDate ?? "—"}`, LEFT, 76, { width: PAGE_W, align: "right" });
        let y = 122;
        y = drawSectionHeader("معلومات الطلب", y);
        y = drawThreeFields([
            ["الرقم المرجعي", id],
            ["رقم التكليف", tx.assignmentNumber ?? "—"],
            ["تاريخ التكليف", tx.assignmentDate ?? "—"],
        ], y);
        y = drawThreeFields([
            [
                "الغرض من التقييم",
                VALUATION_PURPOSES[tx.valuationPurpose ?? ""] ??
                    tx.valuationPurpose ??
                    "—",
            ],
            [
                "أساس القيمة",
                VALUATION_BASES[tx.valuationBasis ?? ""] ?? tx.valuationBasis ?? "—",
            ],
            [
                "نوع الملكية",
                OWNERSHIP_TYPES[tx.ownershipType ?? ""] ?? tx.ownershipType ?? "—",
            ],
        ], y);
        y = drawThreeFields([
            [
                "فرضية التقييم",
                VALUATION_HYPOTHESES[tx.valuationHypothesis ?? ""] ??
                    tx.valuationHypothesis ??
                    "—",
            ],
            ["العميل", tx.clientId ?? "—"],
            ["النموذج", tx.templateId ?? "—"],
        ], y);
        if (tx.intendedUse) {
            const noteH = 40;
            fillRect(LEFT, y, PAGE_W, noteH, COLORS.surfaceAlt);
            strokeRect(LEFT, y, PAGE_W, noteH, COLORS.border);
            textColor(COLORS.textMuted);
            doc.font("Helvetica").fontSize(8);
            doc.text("ملاحظات", LEFT + 4, y + 4, {
                width: PAGE_W - 8,
                align: "right",
            });
            textColor(COLORS.text);
            doc.font("Helvetica").fontSize(9);
            doc.text(tx.intendedUse, LEFT + 4, y + 14, {
                width: PAGE_W - 8,
                align: "right",
            });
            y += noteH + 6;
        }
        y += 4;
        y = drawSectionHeader("معلومات الأصل", y);
        const address = bl["العنوان"] || "—";
        const addrH = 38;
        fillRect(LEFT, y, PAGE_W, addrH, COLORS.surfaceAlt);
        strokeRect(LEFT, y, PAGE_W, addrH, COLORS.border);
        textColor(COLORS.textMuted);
        doc.font("Helvetica").fontSize(8);
        doc.text("العنوان", LEFT + 4, y + 4, { width: PAGE_W - 8, align: "right" });
        textColor(COLORS.text);
        doc.font("Helvetica").fontSize(9);
        doc.text(address, LEFT + 4, y + 14, { width: PAGE_W - 8, align: "right" });
        y += addrH + 4;
        y = drawThreeFields([
            ["نوع الأصل", bl["نوع الأصل"] || "—"],
            ["مساحة الأصل", bl["مساحة الأصل"] || ev.landSpace || "—"],
            ["الاستخدام", bl["الاستخدام"] || "—"],
        ], y);
        y = drawThreeFields([
            ["المعاين", bl["المعاين"] || "—"],
            ["رقم التواصل", bl["رقم التواصل"] || "—"],
            ["المراجع", bl["المراجع"] || "—"],
        ], y);
        y += 4;
        y = drawSectionHeader("الموقع وتصنيف الأصل", y);
        y = drawThreeFields([
            ["المنطقة", (REGIONS[ev.regionId] ?? ev.regionId) || "—"],
            ["المدينة", ev.cityName || "—"],
            ["الحي", ev.neighborhoodName || "—"],
        ], y);
        y = drawTwoFields("نوع الأصل", (PROPERTY_TYPES[ev.propertyTypeId] ?? ev.propertyTypeId) || "—", "تصنيف الأصل", ev.assetCategoryId === "1"
            ? "أراضي"
            : ev.assetCategoryId === "2"
                ? "مباني"
                : "—", y);
        y += 4;
        y = drawSectionHeader("البيانات الأساسية", y);
        y = drawThreeFields([
            ["رمز العقار", ev.propertyCode || "—"],
            ["اسم المالك", ev.ownerName || "—"],
            ["اسم العميل", ev.clientName || "—"],
        ], y);
        y = drawThreeFields([
            ["اسم المفوض", ev.authorizedName || "—"],
            ["رقم الصك", ev.deedNumber || "—"],
            ["تاريخ الصك", ev.deedDate || "—"],
        ], y);
        y += 4;
        y = drawSectionHeader("الحدود والأطوال", y);
        y = drawTwoFields("الحد الشمالي", ev.northBoundary || "—", "طول الحد الشمالي", ev.northLength || "—", y);
        y = drawTwoFields("الحد الجنوبي", ev.southBoundary || "—", "طول الحد الجنوبي", ev.southLength || "—", y);
        y = drawTwoFields("الحد الشرقي", ev.eastBoundary || "—", "طول الحد الشرقي", ev.eastLength || "—", y);
        y = drawTwoFields("الحد الغربي", ev.westBoundary || "—", "طول الحد الغربي", ev.westLength || "—", y);
        y += 4;
        y = drawSectionHeader("بيانات التشطيب", y);
        y = drawThreeFields([
            [
                "حالة المبنى",
                (BUILDING_STATES[ev.buildingState] ?? ev.buildingState) || "—",
            ],
            ["عدد الأدوار", ev.floorsCount || "—"],
            ["عمر العقار", ev.propertyAge || "—"],
        ], y);
        y = drawTwoFields("مستوى التشطيب", (FINISH_LEVELS[ev.finishLevel] ?? ev.finishLevel) || "—", "حالة البناء", (BUILD_QUALITY[ev.buildQuality] ?? ev.buildQuality) || "—", y);
        y += 4;
        doc.addPage();
        y = 40;
        y = drawSectionHeader("جدول المقارنات", y);
        if (compRows.length === 0) {
            fillRect(LEFT, y, PAGE_W, 30, COLORS.surfaceAlt);
            strokeRect(LEFT, y, PAGE_W, 30, COLORS.border);
            textColor(COLORS.textMuted);
            doc.font("Helvetica").fontSize(10);
            doc.text("لا توجد مقارنات محددة", LEFT, y + 10, {
                width: PAGE_W,
                align: "center",
            });
            y += 36;
        }
        else {
            const cols = [
                { label: "م", w: 22 },
                { label: "التاريخ", w: 62 },
                { label: "النوع", w: 70 },
                { label: "نوع المقارنة", w: 60 },
                { label: "المساحة م²", w: 52 },
                { label: "سعر المتر", w: 52 },
                { label: "الإجمالي", w: 62 },
                { label: "الوصف", w: 62 },
                { label: "عدد الشوارع", w: 50 },
                { label: "عرض الشارع", w: 50 },
                { label: "المصدر", w: 62 },
            ];
            const totalW = cols.reduce((s, c) => s + c.w, 0);
            const scale = PAGE_W / totalW;
            const scaledCols = cols.map((c) => ({ ...c, w: c.w * scale }));
            const headerH = 24;
            fillRect(LEFT, y, PAGE_W, headerH, COLORS.tableHeaderBg);
            let cx = LEFT;
            for (const col of scaledCols) {
                textColor("#ffffff");
                doc.font("Helvetica-Bold").fontSize(8);
                doc.text(col.label, cx + 2, y + 8, {
                    width: col.w - 4,
                    align: "center",
                });
                cx += col.w;
            }
            cx = LEFT;
            for (const col of scaledCols) {
                doc
                    .save()
                    .moveTo(cx + col.w, y)
                    .lineTo(cx + col.w, y + headerH)
                    .lineWidth(0.3)
                    .stroke([255, 255, 255])
                    .restore();
                cx += col.w;
            }
            y += headerH;
            const rowH = 22;
            compRows.forEach((row, i) => {
                if (y + rowH > doc.page.height - 50) {
                    doc.addPage();
                    y = 40;
                }
                const bg = i % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
                fillRect(LEFT, y, PAGE_W, rowH, bg);
                strokeRect(LEFT, y, PAGE_W, rowH, COLORS.border, 0.3);
                const propTypeName = PROPERTY_TYPES[row.propertyTypeId] ?? row.propertyTypeId ?? "—";
                const cells = [
                    String(i + 1),
                    row.evalDate || "—",
                    propTypeName,
                    row.comparisonKind || "—",
                    row.landSpace || "—",
                    row.price || "—",
                    row.total || "—",
                    row.description || "—",
                    row.roads || "—",
                    row.street || "—",
                    row.source || "—",
                ];
                cx = LEFT;
                cells.forEach((cell, ci) => {
                    textColor(COLORS.text);
                    doc.font("Helvetica").fontSize(8);
                    doc.text(cell, cx + 2, y + 7, {
                        width: scaledCols[ci].w - 4,
                        align: ci === 0 ? "center" : "right",
                        ellipsis: true,
                    });
                    doc
                        .save()
                        .moveTo(cx + scaledCols[ci].w, y)
                        .lineTo(cx + scaledCols[ci].w, y + rowH)
                        .lineWidth(0.3)
                        .stroke([
                        hexToRgb(COLORS.border)[0],
                        hexToRgb(COLORS.border)[1],
                        hexToRgb(COLORS.border)[2],
                    ])
                        .restore();
                    cx += scaledCols[ci].w;
                });
                y += rowH;
            });
            y += 8;
        }
        if (n > 0) {
            if (y + 60 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            y = drawSectionHeader("جدول التسويات والتعديلات", y);
            const section1Rows = ev.section1Rows ?? [];
            const section2Rows = ev.settlementRows ?? [];
            const bases = ev.settlementBases ?? [];
            const weights = ev.settlementWeights ?? [];
            const effectiveBases = Array.from({ length: n }, (_, c) => bases[c] !== undefined && bases[c] !== ""
                ? bases[c]
                : (compRows[c]?.price ?? ""));
            const s1AdjAmounts = Array.from({ length: n }, (_, c) => {
                const base = parseNum(effectiveBases[c]);
                return section1Rows.reduce((sum, r) => sum + base * (parseNum((r.colAdj || [])[c]) / 100), 0);
            });
            const priceAfterS1 = Array.from({ length: n }, (_, c) => {
                const base = parseNum(effectiveBases[c]);
                return base ? base + s1AdjAmounts[c] : 0;
            });
            const s2AdjAmounts = Array.from({ length: n }, (_, c) => {
                const base = priceAfterS1[c];
                return section2Rows.reduce((sum, r) => sum + base * (parseNum((r.colAdj || [])[c]) / 100), 0);
            });
            const priceAfterAll = Array.from({ length: n }, (_, c) => priceAfterS1[c] + s2AdjAmounts[c]);
            const totalWeight = weights
                .slice(0, n)
                .reduce((s, w) => s + parseNum(w), 0);
            const weightOk = Math.abs(totalWeight - 100) <= 0.01;
            const contributions = Array.from({ length: n }, (_, c) => {
                if (!totalWeight)
                    return 0;
                return priceAfterAll[c] * (parseNum(weights[c]) / 100);
            });
            const netPricePerMeter = weightOk
                ? contributions.reduce((s, v) => s + v, 0)
                : 0;
            const area = parseNum(ev.landSpace);
            const totalPropertyValue = netPricePerMeter * area;
            const itemW = 110;
            const subjectW = 60;
            const compW = n > 0 ? Math.max((PAGE_W - itemW - subjectW) / n, 70) : 70;
            const drawSettlRow = (label, subjectVal, compVals, rowY, bgColor, textCol, bold = false) => {
                if (rowY + 20 > doc.page.height - 50) {
                    doc.addPage();
                    rowY = 40;
                }
                fillRect(LEFT, rowY, PAGE_W, 20, bgColor);
                strokeRect(LEFT, rowY, PAGE_W, 20, COLORS.border, 0.3);
                textColor(textCol);
                doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
                doc.text(label, LEFT + 2, rowY + 6, {
                    width: itemW - 4,
                    align: "right",
                    ellipsis: true,
                });
                doc.text(subjectVal, LEFT + itemW + 2, rowY + 6, {
                    width: subjectW - 4,
                    align: "center",
                });
                for (let c = 0; c < n; c++) {
                    const cx = LEFT + itemW + subjectW + c * compW;
                    doc.text(compVals[c] ?? "—", cx + 2, rowY + 6, {
                        width: compW - 4,
                        align: "center",
                    });
                }
                return rowY + 20;
            };
            if (y + 24 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            fillRect(LEFT, y, PAGE_W, 24, COLORS.tableHeaderBg);
            textColor("#ffffff");
            doc.font("Helvetica-Bold").fontSize(8);
            doc.text("البند", LEFT + 2, y + 8, {
                width: itemW - 4,
                align: "right",
            });
            doc.text("محل التقييم", LEFT + itemW + 2, y + 8, {
                width: subjectW - 4,
                align: "center",
            });
            for (let c = 0; c < n; c++) {
                const cx = LEFT + itemW + subjectW + c * compW;
                doc.text(`مقارنة ${c + 1}`, cx + 2, y + 8, {
                    width: compW - 4,
                    align: "center",
                });
            }
            y += 24;
            y = drawSettlRow("💰 سعر المتر (ريال/م²)", "—", effectiveBases, y, "#dbeafe", COLORS.primary, true);
            y = drawSubHeader("القسم الأول: تعديلات ظروف السوق والتمويل", y);
            for (const row of section1Rows) {
                const adjVals = Array.from({ length: n }, (_, c) => (row.colAdj || [])[c] ?? "—");
                y = drawSettlRow(row.title || "—", row.valueM || "—", adjVals, y, COLORS.rowEven, COLORS.text);
            }
            const s1PctTotals = Array.from({ length: n }, (_, c) => section1Rows.reduce((sum, r) => sum + parseNum((r.colAdj || [])[c]), 0));
            y = drawSettlRow("∑ إجمالي تسويات القسم الأول (%)", "—", s1PctTotals.map((v) => fmt(v, 0)), y, COLORS.totalRow, COLORS.primary, true);
            y = drawSettlRow("📊 السعر بعد تسويات القسم الأول", "—", priceAfterS1.map((v) => fmt(v)), y, "#cfe3ff", COLORS.primary, true);
            y = drawSubHeader("القسم الثاني: تعديلات خصائص العقار", y);
            for (const row of section2Rows) {
                if (!row.inReport)
                    continue;
                const adjVals = Array.from({ length: n }, (_, c) => (row.colAdj || [])[c] ?? "—");
                y = drawSettlRow(row.title || "—", row.valueM || "—", adjVals, y, COLORS.rowEven, COLORS.text);
            }
            const s2PctTotals = Array.from({ length: n }, (_, c) => section2Rows
                .filter((r) => r.inReport !== false)
                .reduce((sum, r) => sum + parseNum((r.colAdj || [])[c]), 0));
            y = drawSettlRow("∑ إجمالي تسويات القسم الثاني (%)", "—", s2PctTotals.map((v) => fmt(v, 0)), y, "#dcfce7", COLORS.green, true);
            y = drawSettlRow("✅ السعر النهائي بعد جميع التسويات", "—", priceAfterAll.map((v) => fmt(v)), y, COLORS.finalRow, "#065f46", true);
            y = drawSettlRow("⚖️ الوزن النسبي %", "—", Array.from({ length: n }, (_, c) => weights[c] ?? "—"), y, COLORS.weightRow, COLORS.amber, true);
            y = drawSettlRow("📐 مساهمة المقارن (مرجح)", "—", contributions.map((v) => fmt(v)), y, COLORS.contributionRow, COLORS.amber, true);
            y += 8;
            if (y + 50 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            const kpiW = (PAGE_W - 8) / 3;
            const kpiH = 44;
            const drawKpi = (label, value, accentColor, x, ky) => {
                fillRect(x, ky, kpiW, kpiH, COLORS.surface);
                strokeRect(x, ky, kpiW, kpiH, COLORS.border);
                fillRect(x + kpiW - 4, ky, 4, kpiH, accentColor);
                textColor(COLORS.textMuted);
                doc.font("Helvetica").fontSize(8);
                doc.text(label, x + 4, ky + 6, { width: kpiW - 12, align: "right" });
                const [r, g, b] = hexToRgb(accentColor);
                doc.fillColor([r, g, b]);
                doc.font("Helvetica-Bold").fontSize(11);
                doc.text(value, x + 4, ky + 20, {
                    width: kpiW - 12,
                    align: "right",
                });
            };
            drawKpi("صافي سعر المتر بعد جميع التسويات", netPricePerMeter ? `${fmt(netPricePerMeter)} ريال/م²` : "—", COLORS.primary, LEFT, y);
            drawKpi("إجمالي الوزن النسبي", totalWeight ? `${fmt(totalWeight, 0)}%${weightOk ? " ✓" : ""}` : "—", weightOk ? COLORS.green : COLORS.red, LEFT + kpiW + 4, y);
            drawKpi("إجمالي قيمة العقار", area && netPricePerMeter ? `${fmt(totalPropertyValue, 0)} ريال` : "—", COLORS.green, LEFT + (kpiW + 4) * 2, y);
            y += kpiH + 10;
        }
        if (ev.finalAssetValue || ev.appraiserDesc || ev.evalDate) {
            if (y + 60 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            y = drawSectionHeader("رأي المقيم", y);
            y = drawThreeFields([
                ["تاريخ المعاينة", ev.evalDate || "—"],
                ["تاريخ التقييم", ev.completedDate || "—"],
                ["تاريخ التقرير", ev.reportDate || "—"],
            ], y);
            const valH = 40;
            fillRect(LEFT, y, PAGE_W, valH, COLORS.primary);
            textColor("#ffffff");
            doc.font("Helvetica").fontSize(9);
            doc.text("القيمة النهائية للأصل", LEFT + 4, y + 6, {
                width: PAGE_W - 8,
                align: "right",
            });
            doc.font("Helvetica-Bold").fontSize(16);
            doc.text(ev.finalAssetValue ? `${ev.finalAssetValue} ريال` : "—", LEFT + 4, y + 18, { width: PAGE_W - 8, align: "right" });
            y += valH + 6;
            if (ev.appraiserDesc) {
                const descH = Math.max(50, Math.ceil(ev.appraiserDesc.length / 80) * 14 + 20);
                fillRect(LEFT, y, PAGE_W, descH, COLORS.surfaceAlt);
                strokeRect(LEFT, y, PAGE_W, descH, COLORS.border);
                textColor(COLORS.textMuted);
                doc.font("Helvetica").fontSize(8);
                doc.text("وصف المقيم ورأيه حول الأصل", LEFT + 4, y + 4, {
                    width: PAGE_W - 8,
                    align: "right",
                });
                textColor(COLORS.text);
                doc.font("Helvetica").fontSize(9);
                doc.text(ev.appraiserDesc, LEFT + 4, y + 16, {
                    width: PAGE_W - 8,
                    align: "right",
                });
                y += descH + 6;
            }
            if (ev.appraiserNotes) {
                const noteH = Math.max(40, Math.ceil(ev.appraiserNotes.length / 80) * 14 + 20);
                fillRect(LEFT, y, PAGE_W, noteH, COLORS.surfaceAlt);
                strokeRect(LEFT, y, PAGE_W, noteH, COLORS.border);
                textColor(COLORS.textMuted);
                doc.font("Helvetica").fontSize(8);
                doc.text("الملاحظات أو النواقص", LEFT + 4, y + 4, {
                    width: PAGE_W - 8,
                    align: "right",
                });
                textColor(COLORS.text);
                doc.font("Helvetica").fontSize(9);
                doc.text(ev.appraiserNotes, LEFT + 4, y + 16, {
                    width: PAGE_W - 8,
                    align: "right",
                });
                y += noteH + 6;
            }
            y += 4;
        }
        const reportFields = [
            ["معايير التقييم المتبعة", ev.standards],
            ["نطاق البحث والاستقصاء", ev.scope],
            ["الافتراضات", ev.assumptions],
            ["المخاطر أو عدم اليقين", ev.risks],
        ].filter(([, v]) => !!v);
        if (reportFields.length > 0) {
            if (y + 60 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            y = drawSectionHeader("بنود التقرير", y);
            for (const [label, value] of reportFields) {
                if (y + 40 > doc.page.height - 50) {
                    doc.addPage();
                    y = 40;
                }
                const h = Math.max(40, Math.ceil(value.length / 90) * 14 + 20);
                fillRect(LEFT, y, PAGE_W, h, COLORS.surfaceAlt);
                strokeRect(LEFT, y, PAGE_W, h, COLORS.border);
                textColor(COLORS.textMuted);
                doc.font("Helvetica").fontSize(8);
                doc.text(label, LEFT + 4, y + 4, { width: PAGE_W - 8, align: "right" });
                textColor(COLORS.text);
                doc.font("Helvetica").fontSize(9);
                doc.text(value, LEFT + 4, y + 16, {
                    width: PAGE_W - 8,
                    align: "right",
                });
                y += h + 6;
            }
        }
        const authors = [
            { id: ev.author1Id, title: ev.author1Title },
            { id: ev.author2Id, title: ev.author2Title },
            { id: ev.author3Id, title: ev.author3Title },
            { id: ev.author4Id, title: ev.author4Title },
        ].filter((a) => a.id);
        if (authors.length > 0) {
            if (y + 60 > doc.page.height - 50) {
                doc.addPage();
                y = 40;
            }
            y = drawSectionHeader("معدي التقرير", y);
            for (let i = 0; i < authors.length; i += 2) {
                if (i + 1 < authors.length) {
                    y = drawTwoFields(`معد ${i + 1} — المعرف`, authors[i].id, `معد ${i + 1} — المنصب`, authors[i].title, y);
                    y = drawTwoFields(`معد ${i + 2} — المعرف`, authors[i + 1].id, `معد ${i + 2} — المنصب`, authors[i + 1].title, y);
                }
                else {
                    y = drawTwoFields(`معد ${i + 1} — المعرف`, authors[i].id, `معد ${i + 1} — المنصب`, authors[i].title, y);
                }
            }
        }
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const footerY = doc.page.height - 30;
            fillRect(LEFT, footerY, PAGE_W, 20, COLORS.surfaceAlt);
            strokeRect(LEFT, footerY, PAGE_W, 20, COLORS.border, 0.3);
            textColor(COLORS.textMuted);
            doc.font("Helvetica").fontSize(8);
            doc.text(`صفحة ${i - range.start + 1} من ${range.count}`, LEFT, footerY + 6, { width: PAGE_W / 2, align: "left" });
            doc.text(`تقرير التقييم العقاري — ${tx.assignmentNumber ?? ""}`, LEFT + PAGE_W / 2, footerY + 6, { width: PAGE_W / 2, align: "right" });
        }
        doc.end();
    }
};
exports.TransactionsPdfService = TransactionsPdfService;
exports.TransactionsPdfService = TransactionsPdfService = __decorate([
    (0, common_1.Injectable)()
], TransactionsPdfService);
