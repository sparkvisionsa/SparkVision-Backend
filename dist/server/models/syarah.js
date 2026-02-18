"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYARAH_COLLECTION = void 0;
exports.getSyarahCollection = getSyarahCollection;
exports.SYARAH_COLLECTION = "syarah";
function getSyarahCollection(db) {
    return db.collection(exports.SYARAH_COLLECTION);
}
