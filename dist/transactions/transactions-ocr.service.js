"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsVisionService = void 0;
const common_1 = require("@nestjs/common");
const generative_ai_1 = require("@google/generative-ai");
const fs = __importStar(require("fs/promises"));
const path_1 = require("path");
let TransactionsVisionService = class TransactionsVisionService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || "YOUR_API_KEY";
        this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" },
        });
    }
    async extractFromImage(filePath) {
        const fullPath = (0, path_1.join)(process.cwd(), filePath);
        try {
            const imageBuffer = await fs.readFile(fullPath);
            const imageData = {
                inlineData: {
                    data: imageBuffer.toString("base64"),
                    mimeType: "image/jpeg",
                },
            };
            const prompt = `
        You are a Saudi Real Estate document expert. Extract data from this 'وثيقة تملك عقار' image into JSON.

        CRITICAL INSTRUCTIONS:
        1. Convert Arabic word-based numbers (e.g., 'أربعة و ستون') into digits (e.g., '64').
        2. If a field says 'لا يوجد' or 'بدون', return that text so we know it was checked.
        3. Keep dates in original Hijri/Gregorian format.

        Field Mapping Guide:
        - deedNumber: (رقم الوثيقة) - top right or first box
        - deedDate: (تاريخ الوثيقة)
        - previousDeedNumber: (رقم الوثيقة السابقة)
        - previousDeedDate: (تاريخ الوثيقة السابقة - التاريخ)
        - operationType: (نوع العملية)
        - propertyStatus: (الحالة)
        - restrictions: (القيود)

        - ownerId: (رقم الهوية) under الملاك
        - ownerName: (الاسم) under الملاك

        - propertyId: (رقم الهوية العقارية) under العقار section
        - propertyType: (نوع العقار)
        - propertyArea: (مساحة العقار)
        - landUse: (نوع الاستخدام)
        - blockNumber: (البلك)
        - districtPart: (المجاورة / الجزء)
        - propertyModel: (نموذج العقار)
        - locationDescription: (الموقع)

        - cityName: (المدينة)
        - neighborhoodName: (الحي)
        - planNumber: (رقم المخطط)
        - parcelNumber: (رقم القطعة)

        - northBoundary / northLength: (الحد شمالاً: وصف الحد / الطول م)
        - southBoundary / southLength: (الحد جنوباً: وصف الحد / الطول م)
        - eastBoundary / eastLength: (الحد شرقاً: وصف الحد / الطول م)
        - westBoundary / westLength: (الحد غرباً: وصف الحد / الطول م)
      `;
            const result = await this.model.generateContent([prompt, imageData]);
            const response = await result.response;
            const text = response.text();
            const extractedData = JSON.parse(text);
            await fs.unlink(fullPath).catch(() => { });
            return extractedData;
        }
        catch (error) {
            throw new common_1.BadRequestException({
                message: "Vision AI extraction failed",
                error: error.message,
            });
        }
    }
};
exports.TransactionsVisionService = TransactionsVisionService;
exports.TransactionsVisionService = TransactionsVisionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], TransactionsVisionService);
