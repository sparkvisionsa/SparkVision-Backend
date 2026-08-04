"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOBASHER_AUCTIONS_COLLECTION = void 0;
exports.getMobasherAuctionsCollection = getMobasherAuctionsCollection;
exports.MOBASHER_AUCTIONS_COLLECTION = "mobasherAuctions";
function getMobasherAuctionsCollection(db) {
    return db.collection(exports.MOBASHER_AUCTIONS_COLLECTION);
}
