"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMvProjectProgressPct = computeMvProjectProgressPct;
exports.countValuationAccountImages = countValuationAccountImages;
const SIMPLE_REPORT_DATA_REQUIRED_FIELDS = [
    "valuationMethod",
    "valuationPurpose",
    "valuePremise",
    "valuationBasis",
    "reportTitle",
    "reportIssueDate",
    "inspectionDate",
    "valuationDate",
    "inspectionLocation",
    "clientName",
];
const SIMPLE_REPORT_STEP_COUNT = 4;
function isReportFieldFilled(value) {
    if (value == null)
        return false;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (typeof value === "string")
        return value.trim().length > 0;
    return true;
}
function isSimpleReportDataStepComplete(data) {
    if (!data)
        return false;
    return SIMPLE_REPORT_DATA_REQUIRED_FIELDS.every((key) => isReportFieldFilled(data[key]));
}
function isReportPreviewStepComplete(data) {
    if (data?.finalValue != null && Number.isFinite(Number(data.finalValue)))
        return true;
    if (isReportFieldFilled(data?.reportTemplateId))
        return true;
    return false;
}
function computeMvProjectProgressPct(input) {
    let completed = 0;
    if (isSimpleReportDataStepComplete(input.reportData))
        completed += 1;
    if ((input.assetImageCount ?? 0) > 0)
        completed += 1;
    if ((input.valuationAccountImageCount ?? 0) > 0)
        completed += 1;
    if (isReportPreviewStepComplete(input.reportData))
        completed += 1;
    return Math.round((completed / SIMPLE_REPORT_STEP_COUNT) * 100);
}
function countValuationAccountImages(workspace) {
    if (!workspace || typeof workspace !== "object")
        return 0;
    const images = workspace.images;
    if (!Array.isArray(images))
        return 0;
    return images.length;
}
