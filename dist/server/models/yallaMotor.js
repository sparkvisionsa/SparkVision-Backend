"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YALLA_MOTOR_NEW_CARS_COLLECTION = exports.YALLA_MOTOR_USED_COLLECTION = exports.YALLA_MOTOR_LEGACY_COLLECTION = void 0;
exports.getYallaMotorCollection = getYallaMotorCollection;
exports.getYallaUsedCollection = getYallaUsedCollection;
exports.getYallaNewCarsCollection = getYallaNewCarsCollection;
exports.YALLA_MOTOR_LEGACY_COLLECTION = "yallamotortest";
exports.YALLA_MOTOR_USED_COLLECTION = "YallaUsed";
exports.YALLA_MOTOR_NEW_CARS_COLLECTION = "yallaMotorNewCars";
function getYallaMotorCollection(db) {
    return db.collection(exports.YALLA_MOTOR_LEGACY_COLLECTION);
}
function getYallaUsedCollection(db) {
    return db.collection(exports.YALLA_MOTOR_USED_COLLECTION);
}
function getYallaNewCarsCollection(db) {
    return db.collection(exports.YALLA_MOTOR_NEW_CARS_COLLECTION);
}
