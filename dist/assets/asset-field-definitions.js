"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHEET_MANUAL_COLUMN_KEY_PREFIX = exports.STANDARD_ASSET_FIELD_TYPES = exports.STANDARD_ASSET_FIELD_KEYS = exports.STANDARD_ASSET_FIELD_DEFINITIONS = exports.ASSET_TYPE_FIELD_DEFINITIONS = exports.BASE_ASSET_FIELD_DEFINITIONS = void 0;
exports.getAssetFieldDefinitions = getAssetFieldDefinitions;
exports.getAssetFieldDefinition = getAssetFieldDefinition;
exports.resolveFieldType = resolveFieldType;
exports.sanitizeCustomColumnKey = sanitizeCustomColumnKey;
exports.isUnsafeMongoFieldKey = isUnsafeMongoFieldKey;
exports.generateSheetManualColumnFieldKey = generateSheetManualColumnFieldKey;
exports.isSheetManualColumnStorageKey = isSheetManualColumnStorageKey;
const mongodb_1 = require("mongodb");
const asset_import_utils_1 = require("./asset-import.utils");
exports.BASE_ASSET_FIELD_DEFINITIONS = [
    { key: "assetId", label: "معرف الأصل", type: "text", isCustom: false },
    { key: "assetName", label: "اسم الأصل", type: "text", isCustom: false },
    { key: "purchaseDate", label: "تاريخ الشراء", type: "date", isCustom: false },
    { key: "originalCost", label: "التكلفة الأصلية", type: "number", isCustom: false },
    { key: "currency", label: "العملة", type: "text", isCustom: false },
    { key: "condition", label: "الحالة", type: "number", isCustom: false },
    { key: "location", label: "الموقع", type: "text", isCustom: false },
    { key: "hasNotes", label: "توجد ملاحظات", type: "boolean", isCustom: false },
    { key: "notes", label: "ملاحظات", type: "text", isCustom: false },
    { key: "valuationMethod", label: "طريقة التقييم", type: "text", isCustom: false },
    { key: "valuationDate", label: "تاريخ التقييم", type: "date", isCustom: false },
    { key: "valuedBy", label: "قِيِّم بواسطة", type: "text", isCustom: false },
    { key: "status", label: "الحالة التشغيلية", type: "text", isCustom: false },
];
exports.ASSET_TYPE_FIELD_DEFINITIONS = {
    vehicles: [
        { key: "make", label: "الماركة", type: "text", isCustom: false },
        { key: "model", label: "الموديل", type: "text", isCustom: false },
        { key: "year", label: "سنة الصنع", type: "number", isCustom: false },
        { key: "mileageKm", label: "العداد بالكيلو", type: "number", isCustom: false },
        { key: "engineSize", label: "حجم المحرك", type: "text", isCustom: false },
        { key: "fuelType", label: "نوع الوقود", type: "text", isCustom: false },
        { key: "licensePlate", label: "رقم اللوحة", type: "text", isCustom: false },
        { key: "chassisNumber", label: "رقم الهيكل", type: "text", isCustom: false },
        { key: "lastServiceDate", label: "تاريخ آخر صيانة", type: "date", isCustom: false },
        { key: "accidentHistory", label: "سجل الحوادث", type: "boolean", isCustom: false },
    ],
    machinery: [
        { key: "manufacturer", label: "الشركة المصنعة", type: "text", isCustom: false },
        { key: "modelNumber", label: "رقم الموديل", type: "text", isCustom: false },
        { key: "serialNumber", label: "الرقم التسلسلي", type: "text", isCustom: false },
        { key: "manufactureYear", label: "سنة الصنع", type: "number", isCustom: false },
        { key: "operatingHours", label: "ساعات التشغيل", type: "number", isCustom: false },
        { key: "powerOutput", label: "القدرة", type: "number", isCustom: false },
        { key: "powerUnit", label: "وحدة القدرة", type: "text", isCustom: false },
        { key: "lastMaintenanceDate", label: "آخر صيانة", type: "date", isCustom: false },
        { key: "nextMaintenanceDate", label: "الصيانة القادمة", type: "date", isCustom: false },
        { key: "capacityTons", label: "السعة بالأطنان", type: "number", isCustom: false },
    ],
    electronics: [
        { key: "brand", label: "العلامة التجارية", type: "text", isCustom: false },
        { key: "modelName", label: "اسم الموديل", type: "text", isCustom: false },
        { key: "serialNumber", label: "الرقم التسلسلي", type: "text", isCustom: false },
        { key: "processorSpec", label: "المعالج", type: "text", isCustom: false },
        { key: "ramGB", label: "الذاكرة RAM", type: "number", isCustom: false },
        { key: "storageGB", label: "سعة التخزين", type: "number", isCustom: false },
        { key: "osVersion", label: "نظام التشغيل", type: "text", isCustom: false },
        { key: "warrantyExpiry", label: "انتهاء الضمان", type: "date", isCustom: false },
        { key: "screenSizeInch", label: "حجم الشاشة", type: "number", isCustom: false },
        { key: "batteryHealthPercent", label: "صحة البطارية", type: "number", isCustom: false },
    ],
    furniture: [
        { key: "furnitureType", label: "نوع الأثاث", type: "text", isCustom: false },
        { key: "material", label: "الخامة", type: "text", isCustom: false },
        { key: "color", label: "اللون", type: "text", isCustom: false },
        { key: "setComplete", label: "الطقم مكتمل", type: "boolean", isCustom: false },
        { key: "setTotalPieces", label: "إجمالي القطع", type: "number", isCustom: false },
        { key: "presentPieces", label: "القطع الموجودة", type: "number", isCustom: false },
        { key: "woodType", label: "نوع الخشب", type: "text", isCustom: false },
        { key: "manufacturer", label: "الشركة المصنعة", type: "text", isCustom: false },
    ],
    other: [],
};
exports.STANDARD_ASSET_FIELD_DEFINITIONS = [
    ...exports.BASE_ASSET_FIELD_DEFINITIONS,
    ...exports.ASSET_TYPE_FIELD_DEFINITIONS.vehicles,
    ...exports.ASSET_TYPE_FIELD_DEFINITIONS.machinery,
    ...exports.ASSET_TYPE_FIELD_DEFINITIONS.electronics,
    ...exports.ASSET_TYPE_FIELD_DEFINITIONS.furniture,
];
exports.STANDARD_ASSET_FIELD_KEYS = new Set(exports.STANDARD_ASSET_FIELD_DEFINITIONS.map((field) => field.key));
exports.STANDARD_ASSET_FIELD_TYPES = new Map(exports.STANDARD_ASSET_FIELD_DEFINITIONS.map((field) => [field.key, field.type]));
function getAssetFieldDefinitions(assetType) {
    if (!assetType) {
        return [...exports.BASE_ASSET_FIELD_DEFINITIONS];
    }
    return [
        ...exports.BASE_ASSET_FIELD_DEFINITIONS,
        ...exports.ASSET_TYPE_FIELD_DEFINITIONS[assetType],
    ];
}
function getAssetFieldDefinition(fieldKey) {
    return exports.STANDARD_ASSET_FIELD_DEFINITIONS.find((field) => field.key === fieldKey);
}
function resolveFieldType(fieldKey) {
    return exports.STANDARD_ASSET_FIELD_TYPES.get(fieldKey);
}
function sanitizeCustomColumnKey(columnName) {
    const normalized = (0, asset_import_utils_1.toWesternDigits)((0, asset_import_utils_1.sanitizeTextInput)(columnName))
        .replace(/[.$]/g, " ")
        .replace(/[^\p{L}\p{N}_ ]+/gu, " ")
        .trim()
        .replace(/\s+/g, "_");
    const baseKey = normalized.length > 0 ? normalized : "custom_column";
    const key = exports.STANDARD_ASSET_FIELD_KEYS.has(baseKey) ? `custom_${baseKey}` : baseKey;
    return key.startsWith("$") ? `custom_${key.slice(1)}` : key;
}
function isUnsafeMongoFieldKey(fieldKey) {
    return (!fieldKey ||
        fieldKey.includes(".") ||
        fieldKey.includes("$") ||
        fieldKey.trim().length === 0);
}
exports.SHEET_MANUAL_COLUMN_KEY_PREFIX = "mvsc_";
function generateSheetManualColumnFieldKey() {
    return `${exports.SHEET_MANUAL_COLUMN_KEY_PREFIX}${new mongodb_1.ObjectId().toHexString()}`;
}
function isSheetManualColumnStorageKey(fieldKey) {
    return (fieldKey.startsWith(exports.SHEET_MANUAL_COLUMN_KEY_PREFIX) &&
        fieldKey.length === exports.SHEET_MANUAL_COLUMN_KEY_PREFIX.length + 24);
}
