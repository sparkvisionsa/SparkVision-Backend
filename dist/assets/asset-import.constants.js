"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_MIME_TYPES = exports.SUPPORTED_EXTENSIONS = exports.ASSET_IMPORT_PERMISSIVE_MIME_TYPES = exports.MIME_TYPES_BY_EXTENSION = exports.ASSET_IMPORT_INSERT_BATCH_SIZE = exports.ASSET_IMPORT_MAX_TOTAL_ROWS = exports.ASSET_IMPORT_MAX_FILE_BYTES = exports.LEGACY_XLS_SIGNATURE = exports.MAX_COLUMN_SCAN_ROWS = void 0;
exports.MAX_COLUMN_SCAN_ROWS = 100;
exports.LEGACY_XLS_SIGNATURE = "D0CF11E0A1B11AE1";
exports.ASSET_IMPORT_MAX_FILE_BYTES = 150 * 1024 * 1024;
exports.ASSET_IMPORT_MAX_TOTAL_ROWS = 200_000;
exports.ASSET_IMPORT_INSERT_BATCH_SIZE = 1000;
exports.MIME_TYPES_BY_EXTENSION = {
    xlsx: new Set([
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
    ]),
    xls: new Set(["application/vnd.ms-excel"]),
    csv: new Set([
        "text/csv",
        "application/csv",
        "text/plain",
        "application/vnd.ms-excel",
    ]),
};
exports.ASSET_IMPORT_PERMISSIVE_MIME_TYPES = new Set([
    "",
    "application/octet-stream",
    "binary/octet-stream",
    "application/x-msdownload",
]);
exports.SUPPORTED_EXTENSIONS = new Set(Object.keys(exports.MIME_TYPES_BY_EXTENSION));
exports.SUPPORTED_MIME_TYPES = new Set(Object.values(exports.MIME_TYPES_BY_EXTENSION).flatMap((mimeSet) => [...mimeSet]));
