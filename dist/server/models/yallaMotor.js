"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YALLA_MOTOR_USED_COLLECTION = exports.YALLA_MOTOR_LEGACY_COLLECTION = void 0;
exports.getYallaMotorCollection = getYallaMotorCollection;
exports.getYallaUsedCollection = getYallaUsedCollection;
exports.YALLA_MOTOR_LEGACY_COLLECTION = "yallamotortest";
exports.YALLA_MOTOR_USED_COLLECTION = "YallaUsed";
function getYallaMotorCollection(db) {
    return db.collection(exports.YALLA_MOTOR_LEGACY_COLLECTION);
}
function getYallaUsedCollection(db) {
    return db.collection(exports.YALLA_MOTOR_USED_COLLECTION);
}
