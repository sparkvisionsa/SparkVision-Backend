import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import * as fs from "fs";
import * as path from "path";
import { getMongoDb } from "@/server/mongodb";
import type { RequestContext } from "@/server/auth-tracking/context";

const COMPANIES_COLLECTION = "companies";
const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;
const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "real-estate-templates");
const USER_COMPANY_MEMBERSHIPS_COLLECTION = "userCompanyMemberships";

export type RealEstateWordTemplate = {
  fileName: string;
  /** relative path under process.cwd(), e.g. "uploads/real-estate-templates/<companyId>/<file>.docx" */
  fileUrl: string | null;
  uploadedAt: string;
  sizeBytes?: number;
};

function requireCompanyAdmin(context: RequestContext): string {
  const companyId = context.company?._id ? String(context.company._id) : null;
  if (!companyId) throw new ForbiddenException("لا يوجد سياق شركة صالح.");
  if (context.user?.role !== "company_admin" && context.user?.role !== "super_admin") {
    throw new ForbiddenException("هذا الإجراء لمديري الشركة فقط.");
  }
  return companyId;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_\u0600-\u06FF]/g, "_");
}

function absoluteFromRelative(relativePath: string): string {
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
}

function decodeDocxDataUrl(fileDataUrl: string): Buffer {
  const commaIndex = fileDataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? fileDataUrl.slice(commaIndex + 1) : fileDataUrl;
  return Buffer.from(base64, "base64");
}

/**
 * قالب Word مستقل للتقارير العقارية، يُخزَّن على القرص تحت
 * uploads/real-estate-templates/<companyId>/ ويُحفظ مساره فقط في وثيقة الشركة
 * تحت المفتاح company.reportTemplates.realEstate.
 * منفصل تماماً عن قالب تقييم الآلات (company.reportDefaults.wordTemplate).
 */
@Injectable()
export class RealEstateReportTemplateService {
  async getTemplate(context: RequestContext): Promise<RealEstateWordTemplate | null> {
    const companyId = context.company?._id ? String(context.company._id) : null;
    if (!companyId) return null;
    const db = await getMongoDb();
    const company = await db
      .collection(COMPANIES_COLLECTION)
      .findOne(
        { _id: new ObjectId(companyId) },
        { projection: { "reportTemplates.realEstate": 1 } },
      );
    return company?.reportTemplates?.realEstate ?? null;
  }



  /** يُستخدم داخلياً فقط عند دمج التقرير الفعلي — يعيد المسار المطلق على القرص إن وُجد الملف. */
  async getTemplateForRender(
    companyId: string,
  ): Promise<(RealEstateWordTemplate & { absolutePath: string }) | null> {
    const db = await getMongoDb();
    const company = await db
      .collection(COMPANIES_COLLECTION)
      .findOne(
        { _id: new ObjectId(companyId) },
        { projection: { "reportTemplates.realEstate": 1 } },
      );
    const template = company?.reportTemplates?.realEstate as RealEstateWordTemplate | undefined;
    if (!template?.fileUrl) return null;
    const absolutePath = absoluteFromRelative(template.fileUrl);
    if (!fs.existsSync(absolutePath)) return null;
    return { ...template, absolutePath };
  }

  async getTemplateForRenderByUserFallback(
    userId: string,
    excludeCompanyId?: string | null,
  ): Promise<
    (RealEstateWordTemplate & { absolutePath: string; companyId: string }) | null
  > {
    if (!ObjectId.isValid(userId)) return null;

    const db = await getMongoDb();
    const memberships = await db
      .collection(USER_COMPANY_MEMBERSHIPS_COLLECTION)
      .find({ userId: new ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .toArray();

    for (const m of memberships) {
      const companyId = String(m.companyId);
      if (excludeCompanyId && companyId === String(excludeCompanyId)) continue;

      const template = await this.getTemplateForRender(companyId);
      if (template) {
        return { ...template, companyId };
      }
    }

    return null;
  }

  async upsertTemplate(
    context: RequestContext,
    body: { fileName?: string; fileDataUrl?: string; sizeBytes?: number },
  ): Promise<RealEstateWordTemplate> {
    const companyId = requireCompanyAdmin(context);
    const fileName = body.fileName?.trim();
    const fileDataUrl = body.fileDataUrl?.trim();
    if (!fileName || !fileName.toLowerCase().endsWith(".docx")) {
      throw new BadRequestException("يجب رفع ملف Word بصيغة .docx.");
    }
    if (!fileDataUrl || !fileDataUrl.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      throw new BadRequestException("ملف القالب غير صالح.");
    }
    if (typeof body.sizeBytes === "number" && body.sizeBytes > MAX_TEMPLATE_BYTES) {
      throw new BadRequestException("حجم قالب Word يجب ألا يتجاوز 25MB.");
    }

    const buffer = decodeDocxDataUrl(fileDataUrl);
    if (buffer.byteLength > MAX_TEMPLATE_BYTES) {
      throw new BadRequestException("حجم قالب Word يجب ألا يتجاوز 25MB.");
    }

    const db = await getMongoDb();

    // Remove previous file on disk (if any) before writing the new one.
    const existing = await db
      .collection(COMPANIES_COLLECTION)
      .findOne(
        { _id: new ObjectId(companyId) },
        { projection: { "reportTemplates.realEstate": 1 } },
      );
    const previousUrl = existing?.reportTemplates?.realEstate?.fileUrl as string | undefined;
    if (previousUrl) {
      const prevAbs = absoluteFromRelative(previousUrl);
      fs.promises.unlink(prevAbs).catch(() => {});
    }

    const companyDir = path.join(UPLOAD_ROOT, companyId);
    await fs.promises.mkdir(companyDir, { recursive: true });
    const storedName = `${Date.now()}-${sanitizeFileName(fileName)}`;
    const absoluteFilePath = path.join(companyDir, storedName);
    await fs.promises.writeFile(absoluteFilePath, buffer);

    const relativeFileUrl = path.relative(process.cwd(), absoluteFilePath);

    const template: RealEstateWordTemplate = {
      fileName,
      fileUrl: relativeFileUrl,
      uploadedAt: new Date().toISOString(),
      sizeBytes: buffer.byteLength,
    };

    const result = await db
      .collection(COMPANIES_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(companyId) },
        { $set: { "reportTemplates.realEstate": template } },
        { returnDocument: "after" },
      );
    if (!result) throw new NotFoundException("الشركة غير موجودة.");

    return template;
  }

  async deleteTemplate(context: RequestContext): Promise<void> {
    const companyId = requireCompanyAdmin(context);
    const db = await getMongoDb();

    const existing = await db
      .collection(COMPANIES_COLLECTION)
      .findOne(
        { _id: new ObjectId(companyId) },
        { projection: { "reportTemplates.realEstate": 1 } },
      );
    const previousUrl = existing?.reportTemplates?.realEstate?.fileUrl as string | undefined;
    if (previousUrl) {
      const prevAbs = absoluteFromRelative(previousUrl);
      fs.promises.unlink(prevAbs).catch(() => {});
    }

    await db
      .collection(COMPANIES_COLLECTION)
      .updateOne({ _id: new ObjectId(companyId) }, { $unset: { "reportTemplates.realEstate": "" } });
  }
}
