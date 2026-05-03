// transactions-vision.service.ts
import { Injectable, BadRequestException } from "@nestjs/common";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs/promises";
import { join } from "path";
export interface ExtractedPropertyData {
  // ===== DOCUMENT =====
  deedNumber?: string;
  deedDate?: string;
  previousDeedNumber?: string; // New: رقم الوثيقة السابقة
  previousDeedDate?: string;
  operationType?: string;
  propertyStatus?: string; // New: الحالة (e.g., فعال)
  restrictions?: string; // New: القيود (e.g., لا يوجد قيود)

  // ===== OWNER =====
  ownerId?: string;
  ownerName?: string;
  ownerNationality?: string;
  ownershipPercentage?: string;

  // ===== PROPERTY =====
  propertyId?: string; // New: رقم الهوية العقارية
  propertyType?: string;
  propertyArea?: string;
  landUse?: string;
  parcelNumber?: string; // New: رقم القطعة
  blockNumber?: string; // New: البلك
  districtPart?: string; // New: المجاورة / الجزء
  propertyModel?: string; // New: نموذج العقار

  // ===== LOCATION =====
  cityName?: string;
  neighborhoodName?: string;
  planNumber?: string;
  plotNumber?: string; // Often synonymous with parcelNumber
  locationDescription?: string; // New: الموقع

  // ===== BOUNDARIES =====
  northBoundary?: string;
  northLength?: string;
  southBoundary?: string;
  southLength?: string;
  eastBoundary?: string;
  eastLength?: string;
  westBoundary?: string;
  westLength?: string;
}
@Injectable()
export class TransactionsVisionService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    // Replace with your API Key from Google AI Studio
    const apiKey = process.env.GEMINI_API_KEY || "YOUR_API_KEY";
    this.genAI = new GoogleGenerativeAI(apiKey);

    // Using 1.5 Flash: It's fast, accurate for OCR, and has a huge free tier
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });
  }

  async extractFromImage(filePath: string): Promise<ExtractedPropertyData> {
    const fullPath = join(process.cwd(), filePath);

    try {
      // 1. Read image and convert to Base64
      const imageBuffer = await fs.readFile(fullPath);
      const imageData = {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType: "image/jpeg",
        },
      };

      // 2. The "Intelligence": Describe what you want in plain text
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
      // 3. Call the Vision API
      const result = await this.model.generateContent([prompt, imageData]);
      const response = await result.response;
      const text = response.text();

      // 4. Parse and Clean up
      const extractedData = JSON.parse(text) as ExtractedPropertyData;

      // Optional: Cleanup local file after processing
      await fs.unlink(fullPath).catch(() => {});

      return extractedData;
    } catch (error: any) {
      throw new BadRequestException({
        message: "Vision AI extraction failed",
        error: error.message,
      });
    }
  }
}
