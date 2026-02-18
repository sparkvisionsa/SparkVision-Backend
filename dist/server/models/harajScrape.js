"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARS_HARAJ_COLLECTION = exports.HARAJ_SCRAPE_COLLECTION = void 0;
exports.getHarajScrapeCollection = getHarajScrapeCollection;
exports.getCarsHarajCollection = getCarsHarajCollection;
exports.HARAJ_SCRAPE_COLLECTION = "harajScrape";
exports.CARS_HARAJ_COLLECTION = "CarsHaraj";
function getHarajScrapeCollection(db) {
    return db.collection(exports.HARAJ_SCRAPE_COLLECTION);
}
function getCarsHarajCollection(db) {
    return db.collection(exports.CARS_HARAJ_COLLECTION);
}
