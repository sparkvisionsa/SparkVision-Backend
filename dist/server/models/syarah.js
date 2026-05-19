"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYARAH_NEW_COLLECTION = exports.SYARAH_COLLECTION = void 0;
exports.getSyarahCollection = getSyarahCollection;
exports.getSyarahNewCollection = getSyarahNewCollection;
exports.SYARAH_COLLECTION = "syarah";
exports.SYARAH_NEW_COLLECTION = "syarahnew";
function getSyarahCollection(db) {
    return db.collection(exports.SYARAH_COLLECTION);
}
function getSyarahNewCollection(db) {
    return db.collection(exports.SYARAH_NEW_COLLECTION);
}
