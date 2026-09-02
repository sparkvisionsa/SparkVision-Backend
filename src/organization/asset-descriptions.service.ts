import type { Request } from "express";
import type { Collection, Db, ObjectId, WithId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { getMongoDb } from "@/server/mongodb";
import {
  HttpError,
  assertCsrf,
} from "@/server/auth-tracking/service";
import {
  resolveRequestContext,
  type RequestContext,
} from "@/server/auth-tracking/context";
import { randomId } from "@/server/auth-tracking/crypto";
import {
  ASSET_DESCRIPTIONS_COLLECTION,
  ASSET_DESCRIPTIONS_SINGLETON_ID,
  LEGACY_ASSET_DESCRIPTIONS_COLLECTION,
} from "./asset-descriptions.constants";

export { ASSET_DESCRIPTIONS_COLLECTION } from "./asset-descriptions.constants";

const LABEL_MAX = 160;
const LIST_MAX = 2_000;
const DESCRIPTIONS_MAX = 5_000;

export type AssetDescriptionTaxonomyItem = {
  id: string;
  label: string;
};

export type AssetDescriptionTypeItem = {
  id: string;
  categoryId: string;
  label: string;
};

export type AssetDescriptionNameItem = {
  id: string;
  typeId: string;
  label: string;
};

export type AssetDescriptionItem = {
  id: string;
  categoryId: string;
  typeId: string;
  nameId: string;
  category: string;
  type: string;
  name: string;
  mainImageUrl: string | null;
};

export type CompanyAssetDescriptionsDoc = {
  categories: AssetDescriptionTaxonomyItem[];
  types: AssetDescriptionTypeItem[];
  names: AssetDescriptionNameItem[];
  descriptions: AssetDescriptionItem[];
  createdAt: Date;
  updatedAt: Date;
};

export type AssetDescriptionsPayload = {
  categories: AssetDescriptionTaxonomyItem[];
  types: AssetDescriptionTypeItem[];
  names: AssetDescriptionNameItem[];
  descriptions: AssetDescriptionItem[];
};

type CatalogDoc = WithId<CompanyAssetDescriptionsDoc>;
const CATALOG_OBJECT_ID = new MongoObjectId(ASSET_DESCRIPTIONS_SINGLETON_ID);
const ASSET_DESCRIPTION_IMAGE_UPLOAD_PREFIX = "/uploads/asset-descriptions/";
const ASSET_DESCRIPTION_IMAGE_MAX_BYTES = 1_500_000;

function assertCompanyAdminUser(context: RequestContext): asserts context is RequestContext & {
  user: NonNullable<RequestContext["user"]>;
  company: NonNullable<RequestContext["company"]>;
  companyMembership: NonNullable<RequestContext["companyMembership"]> & {
    role: "company_admin";
  };
} {
  if (!context.user) {
    throw new HttpError(401, "not_authenticated", "Authentication required.");
  }
  if (context.isUserBlocked || context.user.isBlocked) {
    throw new HttpError(403, "user_blocked", "User account is blocked.");
  }
  if (
    !context.company ||
    !context.companyMembership ||
    context.companyMembership.role !== "company_admin"
  ) {
    throw new HttpError(403, "forbidden", "Company administrator access required.");
  }
}

function assertCompanyMemberUser(context: RequestContext): asserts context is RequestContext & {
  user: NonNullable<RequestContext["user"]>;
  company: NonNullable<RequestContext["company"]>;
  companyMembership: NonNullable<RequestContext["companyMembership"]>;
} {
  if (!context.user) {
    throw new HttpError(401, "not_authenticated", "Authentication required.");
  }
  if (context.isUserBlocked || context.user.isBlocked) {
    throw new HttpError(403, "user_blocked", "User account is blocked.");
  }
  if (!context.company || !context.companyMembership) {
    throw new HttpError(403, "forbidden", "Company membership required.");
  }
}

function coerceRequestJsonBody(body: unknown): unknown {
  if (body == null) return {};
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return {};
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof body !== "object" || Array.isArray(body)) return {};
  return body;
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

function labelsEqual(a: string, b: string) {
  return a.trim().toLocaleLowerCase("ar") === b.trim().toLocaleLowerCase("ar");
}

function collection(db: Db): Collection<CompanyAssetDescriptionsDoc> {
  return db.collection<CompanyAssetDescriptionsDoc>(ASSET_DESCRIPTIONS_COLLECTION);
}

function emptyCatalog(now = new Date()): CompanyAssetDescriptionsDoc {
  return {
    categories: [],
    types: [],
    names: [],
    descriptions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function toPayload(doc: CompanyAssetDescriptionsDoc): AssetDescriptionsPayload {
  return {
    categories: Array.isArray(doc.categories) ? doc.categories : [],
    types: Array.isArray(doc.types) ? doc.types : [],
    names: Array.isArray(doc.names) ? doc.names : [],
    descriptions: Array.isArray(doc.descriptions)
      ? doc.descriptions.map((item) => ({
          ...item,
          mainImageUrl:
            typeof item.mainImageUrl === "string" && item.mainImageUrl.trim()
              ? item.mainImageUrl.trim()
              : null,
        }))
      : [],
  };
}

async function loadOrCreateCatalog(db: Db, _companyId?: ObjectId): Promise<CatalogDoc> {
  const col = collection(db);
  const existing = await col.findOne({ _id: CATALOG_OBJECT_ID });
  if (existing) {
    return {
      ...existing,
      categories: Array.isArray(existing.categories) ? existing.categories : [],
      types: Array.isArray(existing.types) ? existing.types : [],
      names: Array.isArray(existing.names) ? existing.names : [],
      descriptions: Array.isArray(existing.descriptions)
        ? existing.descriptions.map((item) => ({
            ...item,
            mainImageUrl:
              typeof item.mainImageUrl === "string" && item.mainImageUrl.trim()
                ? item.mainImageUrl.trim()
                : null,
          }))
        : [],
    };
  }

  const legacyRows = await db
    .collection<CompanyAssetDescriptionsDoc & { companyId?: ObjectId }>(
      LEGACY_ASSET_DESCRIPTIONS_COLLECTION,
    )
    .find({})
    .toArray();
  const legacy = legacyRows.sort(
    (a, b) =>
      (Array.isArray(b.descriptions) ? b.descriptions.length : 0) -
      (Array.isArray(a.descriptions) ? a.descriptions.length : 0),
  )[0];

  const now = new Date();
  const doc: CatalogDoc = {
    _id: CATALOG_OBJECT_ID,
    ...emptyCatalog(now),
    ...(legacy
      ? {
          categories: Array.isArray(legacy.categories) ? legacy.categories : [],
          types: Array.isArray(legacy.types) ? legacy.types : [],
          names: Array.isArray(legacy.names) ? legacy.names : [],
          descriptions: Array.isArray(legacy.descriptions)
            ? legacy.descriptions.map((item) => ({ ...item, mainImageUrl: null }))
            : [],
        }
      : {}),
  };
  try {
    const inserted = await col.insertOne(doc);
    return { ...doc, _id: inserted.insertedId };
  } catch {
    const raced = await col.findOne({ _id: CATALOG_OBJECT_ID });
    if (raced) return raced;
    throw new HttpError(500, "catalog_create_failed", "تعذر إنشاء قائمة وصف الأصول.");
  }
}

async function saveCatalog(db: Db, doc: CatalogDoc): Promise<CatalogDoc> {
  const now = new Date();
  const next: CatalogDoc = { ...doc, updatedAt: now };
  await collection(db).updateOne(
    { _id: doc._id },
    {
      $set: {
        categories: next.categories,
        types: next.types,
        names: next.names,
        descriptions: next.descriptions,
        updatedAt: now,
      },
    },
  );
  return next;
}

function findCategory(doc: CatalogDoc, id: string) {
  return doc.categories.find((item) => item.id === id) ?? null;
}

function findType(doc: CatalogDoc, id: string) {
  return doc.types.find((item) => item.id === id) ?? null;
}

function findName(doc: CatalogDoc, id: string) {
  return doc.names.find((item) => item.id === id) ?? null;
}

function ensureUniqueLabel(
  items: { id: string; label: string }[],
  label: string,
  exceptId?: string,
) {
  const clash = items.find((item) => item.id !== exceptId && labelsEqual(item.label, label));
  if (clash) {
    throw new HttpError(409, "duplicate_label", "هذه القيمة موجودة مسبقاً في القائمة.");
  }
}

function requireLabel(value: unknown, fieldName: string) {
  const label = normalizeLabel(value);
  if (!label) {
    throw new HttpError(400, "invalid_payload", `${fieldName} مطلوب.`);
  }
  return label;
}

function syncDescriptionTexts(doc: CatalogDoc) {
  const categoryById = new Map(doc.categories.map((item) => [item.id, item.label]));
  const typeById = new Map(doc.types.map((item) => [item.id, item.label]));
  const nameById = new Map(doc.names.map((item) => [item.id, item.label]));
  doc.descriptions = doc.descriptions.map((item) => ({
    ...item,
    category: categoryById.get(item.categoryId) ?? item.category,
    type: typeById.get(item.typeId) ?? item.type,
    name: nameById.get(item.nameId) ?? item.name,
  }));
}

function findOrCreateCategory(doc: CatalogDoc, label: string) {
  const existing = doc.categories.find((item) => labelsEqual(item.label, label));
  if (existing) return existing;
  if (doc.categories.length >= LIST_MAX) {
    throw new HttpError(400, "limit_exceeded", "تم بلوغ الحد الأقصى للفئات.");
  }
  const created: AssetDescriptionTaxonomyItem = { id: randomId(), label };
  doc.categories.push(created);
  return created;
}

function findOrCreateType(doc: CatalogDoc, categoryId: string, label: string) {
  const existing = doc.types.find(
    (item) => item.categoryId === categoryId && labelsEqual(item.label, label),
  );
  if (existing) return existing;
  if (doc.types.length >= LIST_MAX) {
    throw new HttpError(400, "limit_exceeded", "تم بلوغ الحد الأقصى للأنواع.");
  }
  const created: AssetDescriptionTypeItem = { id: randomId(), categoryId, label };
  doc.types.push(created);
  return created;
}

function findOrCreateName(doc: CatalogDoc, typeId: string, label: string) {
  const existing = doc.names.find(
    (item) => item.typeId === typeId && labelsEqual(item.label, label),
  );
  if (existing) return existing;
  if (doc.names.length >= LIST_MAX) {
    throw new HttpError(400, "limit_exceeded", "تم بلوغ الحد الأقصى لأسماء الأصول.");
  }
  const created: AssetDescriptionNameItem = { id: randomId(), typeId, label };
  doc.names.push(created);
  return created;
}

const labelBodySchema = z.object({
  label: z.string().optional(),
});

const typeCreateSchema = z.object({
  categoryId: z.string().optional(),
  label: z.string().optional(),
});

const nameCreateSchema = z.object({
  typeId: z.string().optional(),
  label: z.string().optional(),
});

const descriptionCreateSchema = z.object({
  categoryId: z.string().optional(),
  typeId: z.string().optional(),
  nameId: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
});

const mainImageBodySchema = z.object({
  imageDataUrl: z.string().max(2_100_000).nullable(),
});

function parseAssetDescriptionImageDataUrl(
  value: string,
): { buffer: Buffer; extension: "jpg" | "png" | "webp" } | null {
  const match = value.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,([a-z0-9+/=\s]+)$/i,
  );
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.byteLength <= 0 || buffer.byteLength > ASSET_DESCRIPTION_IMAGE_MAX_BYTES) {
    return null;
  }
  return {
    buffer,
    extension: mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg",
  };
}

async function persistAssetDescriptionMainImage(
  descriptionId: string,
  imageDataUrl: string,
): Promise<string> {
  const parsed = parseAssetDescriptionImageDataUrl(imageDataUrl);
  if (!parsed) {
    throw new HttpError(
      400,
      "invalid_asset_description_image",
      "الصورة الرئيسية يجب أن تكون PNG أو JPG أو WEBP وبحجم لا يتجاوز 1.5MB.",
    );
  }
  const safeId = descriptionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "description";
  const directory = join(process.cwd(), "uploads", "asset-descriptions");
  await mkdir(directory, { recursive: true });
  const filename = `${safeId}-${Date.now()}-${randomId()}.${parsed.extension}`;
  await writeFile(join(directory, filename), parsed.buffer);
  return `${ASSET_DESCRIPTION_IMAGE_UPLOAD_PREFIX}${filename}`;
}

async function removeAssetDescriptionMainImage(imageUrl: unknown): Promise<void> {
  if (
    typeof imageUrl !== "string" ||
    !imageUrl.startsWith(ASSET_DESCRIPTION_IMAGE_UPLOAD_PREFIX)
  ) {
    return;
  }
  const filename = basename(imageUrl);
  if (!filename) return;
  await rm(join(process.cwd(), "uploads", "asset-descriptions", filename), { force: true }).catch(
    () => undefined,
  );
}

async function removeDescriptionImages(items: AssetDescriptionItem[]): Promise<void> {
  await Promise.all(items.map((item) => removeAssetDescriptionMainImage(item.mainImageUrl)));
}

export async function getCompanyAssetDescriptions(request: Request) {
  const context = await resolveRequestContext(request);
  assertCompanyMemberUser(context);
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  return { context, payload: toPayload(doc) };
}

export async function createAssetDescriptionCategory(request: Request, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const parsed = labelBodySchema.safeParse(coerceRequestJsonBody(body));
  if (!parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات الفئة غير صالحة.");
  }
  const label = requireLabel(parsed.data.label, "الفئة");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  ensureUniqueLabel(doc.categories, label);
  const created = findOrCreateCategory(doc, label);
  const saved = await saveCatalog(db, doc);
  return { context, payload: { ...toPayload(saved), created } };
}

export async function updateAssetDescriptionCategory(
  request: Request,
  categoryId: string,
  body: unknown,
) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(categoryId ?? "").trim();
  const parsed = labelBodySchema.safeParse(coerceRequestJsonBody(body));
  if (!id || !parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات الفئة غير صالحة.");
  }
  const label = requireLabel(parsed.data.label, "الفئة");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const current = findCategory(doc, id);
  if (!current) throw new HttpError(404, "not_found", "الفئة غير موجودة.");
  ensureUniqueLabel(doc.categories, label, id);
  current.label = label;
  syncDescriptionTexts(doc);
  const saved = await saveCatalog(db, doc);
  return { context, payload: toPayload(saved) };
}

export async function deleteAssetDescriptionCategory(request: Request, categoryId: string) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(categoryId ?? "").trim();
  if (!id) throw new HttpError(400, "invalid_payload", "معرّف الفئة مطلوب.");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  if (!findCategory(doc, id)) throw new HttpError(404, "not_found", "الفئة غير موجودة.");
  const typeIds = new Set(doc.types.filter((item) => item.categoryId === id).map((item) => item.id));
  const removedDescriptions = doc.descriptions.filter((item) => item.categoryId === id);
  doc.categories = doc.categories.filter((item) => item.id !== id);
  doc.types = doc.types.filter((item) => item.categoryId !== id);
  doc.names = doc.names.filter((item) => !typeIds.has(item.typeId));
  doc.descriptions = doc.descriptions.filter((item) => item.categoryId !== id);
  const saved = await saveCatalog(db, doc);
  await removeDescriptionImages(removedDescriptions);
  return { context, payload: toPayload(saved) };
}

export async function createAssetDescriptionType(request: Request, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const parsed = typeCreateSchema.safeParse(coerceRequestJsonBody(body));
  if (!parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات النوع غير صالحة.");
  }
  const categoryId = String(parsed.data.categoryId ?? "").trim();
  const label = requireLabel(parsed.data.label, "النوع");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  if (!findCategory(doc, categoryId)) {
    throw new HttpError(400, "invalid_payload", "اختر فئة صالحة قبل إضافة النوع.");
  }
  ensureUniqueLabel(
    doc.types.filter((item) => item.categoryId === categoryId),
    label,
  );
  const created = findOrCreateType(doc, categoryId, label);
  const saved = await saveCatalog(db, doc);
  return { context, payload: { ...toPayload(saved), created } };
}

export async function updateAssetDescriptionType(request: Request, typeId: string, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(typeId ?? "").trim();
  const parsed = labelBodySchema.safeParse(coerceRequestJsonBody(body));
  if (!id || !parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات النوع غير صالحة.");
  }
  const label = requireLabel(parsed.data.label, "النوع");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const current = findType(doc, id);
  if (!current) throw new HttpError(404, "not_found", "النوع غير موجود.");
  ensureUniqueLabel(
    doc.types.filter((item) => item.categoryId === current.categoryId),
    label,
    id,
  );
  current.label = label;
  syncDescriptionTexts(doc);
  const saved = await saveCatalog(db, doc);
  return { context, payload: toPayload(saved) };
}

export async function deleteAssetDescriptionType(request: Request, typeId: string) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(typeId ?? "").trim();
  if (!id) throw new HttpError(400, "invalid_payload", "معرّف النوع مطلوب.");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  if (!findType(doc, id)) throw new HttpError(404, "not_found", "النوع غير موجود.");
  const removedDescriptions = doc.descriptions.filter((item) => item.typeId === id);
  doc.types = doc.types.filter((item) => item.id !== id);
  doc.names = doc.names.filter((item) => item.typeId !== id);
  doc.descriptions = doc.descriptions.filter((item) => item.typeId !== id);
  const saved = await saveCatalog(db, doc);
  await removeDescriptionImages(removedDescriptions);
  return { context, payload: toPayload(saved) };
}

export async function createAssetDescriptionName(request: Request, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const parsed = nameCreateSchema.safeParse(coerceRequestJsonBody(body));
  if (!parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات اسم الأصل غير صالحة.");
  }
  const typeId = String(parsed.data.typeId ?? "").trim();
  const label = requireLabel(parsed.data.label, "اسم الأصل");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  if (!findType(doc, typeId)) {
    throw new HttpError(400, "invalid_payload", "اختر نوعاً صالحاً قبل إضافة اسم الأصل.");
  }
  ensureUniqueLabel(
    doc.names.filter((item) => item.typeId === typeId),
    label,
  );
  const created = findOrCreateName(doc, typeId, label);
  const saved = await saveCatalog(db, doc);
  return { context, payload: { ...toPayload(saved), created } };
}

export async function updateAssetDescriptionName(request: Request, nameId: string, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(nameId ?? "").trim();
  const parsed = labelBodySchema.safeParse(coerceRequestJsonBody(body));
  if (!id || !parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات اسم الأصل غير صالحة.");
  }
  const label = requireLabel(parsed.data.label, "اسم الأصل");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const current = findName(doc, id);
  if (!current) throw new HttpError(404, "not_found", "اسم الأصل غير موجود.");
  ensureUniqueLabel(
    doc.names.filter((item) => item.typeId === current.typeId),
    label,
    id,
  );
  current.label = label;
  syncDescriptionTexts(doc);
  const saved = await saveCatalog(db, doc);
  return { context, payload: toPayload(saved) };
}

export async function deleteAssetDescriptionName(request: Request, nameId: string) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(nameId ?? "").trim();
  if (!id) throw new HttpError(400, "invalid_payload", "معرّف اسم الأصل مطلوب.");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  if (!findName(doc, id)) throw new HttpError(404, "not_found", "اسم الأصل غير موجود.");
  const removedDescriptions = doc.descriptions.filter((item) => item.nameId === id);
  doc.names = doc.names.filter((item) => item.id !== id);
  doc.descriptions = doc.descriptions.filter((item) => item.nameId !== id);
  const saved = await saveCatalog(db, doc);
  await removeDescriptionImages(removedDescriptions);
  return { context, payload: toPayload(saved) };
}

function resolveLinkedLabels(
  doc: CatalogDoc,
  input: {
    categoryId?: string;
    typeId?: string;
    nameId?: string;
    category?: string;
    type?: string;
    name?: string;
  },
) {
  const categoryLabel = normalizeLabel(input.category);
  const typeLabel = normalizeLabel(input.type);
  const nameLabel = normalizeLabel(input.name);

  const category =
    (input.categoryId ? findCategory(doc, input.categoryId.trim()) : null) ??
    (categoryLabel ? findOrCreateCategory(doc, categoryLabel) : null);
  if (!category) {
    throw new HttpError(400, "invalid_payload", "الفئة مطلوبة.");
  }

  const type =
    (input.typeId ? findType(doc, input.typeId.trim()) : null) ??
    (typeLabel ? findOrCreateType(doc, category.id, typeLabel) : null);
  if (!type) {
    throw new HttpError(400, "invalid_payload", "النوع مطلوب.");
  }
  if (type.categoryId !== category.id) {
    throw new HttpError(400, "invalid_payload", "النوع غير مرتبط بالفئة المحددة.");
  }

  const name =
    (input.nameId ? findName(doc, input.nameId.trim()) : null) ??
    (nameLabel ? findOrCreateName(doc, type.id, nameLabel) : null);
  if (!name) {
    throw new HttpError(400, "invalid_payload", "اسم الأصل مطلوب.");
  }
  if (name.typeId !== type.id) {
    throw new HttpError(400, "invalid_payload", "اسم الأصل غير مرتبط بالنوع المحدد.");
  }

  return { category, type, name };
}

export async function createAssetDescription(request: Request, body: unknown) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const parsed = descriptionCreateSchema.safeParse(coerceRequestJsonBody(body));
  if (!parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات وصف الأصل غير صالحة.");
  }
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const linked = resolveLinkedLabels(doc, parsed.data);
  const duplicate = doc.descriptions.find(
    (item) =>
      item.categoryId === linked.category.id &&
      item.typeId === linked.type.id &&
      item.nameId === linked.name.id,
  );
  if (duplicate) {
    throw new HttpError(409, "duplicate_description", "هذا الوصف موجود مسبقاً في القائمة.");
  }
  if (doc.descriptions.length >= DESCRIPTIONS_MAX) {
    throw new HttpError(400, "limit_exceeded", "تم بلوغ الحد الأقصى لوصف الأصول.");
  }
  const created: AssetDescriptionItem = {
    id: randomId(),
    categoryId: linked.category.id,
    typeId: linked.type.id,
    nameId: linked.name.id,
    category: linked.category.label,
    type: linked.type.label,
    name: linked.name.label,
    mainImageUrl: null,
  };
  doc.descriptions.push(created);
  const saved = await saveCatalog(db, doc);
  return { context, payload: { ...toPayload(saved), created } };
}

export async function updateAssetDescription(
  request: Request,
  descriptionId: string,
  body: unknown,
) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(descriptionId ?? "").trim();
  const parsed = descriptionCreateSchema.safeParse(coerceRequestJsonBody(body));
  if (!id || !parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات وصف الأصل غير صالحة.");
  }
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const current = doc.descriptions.find((item) => item.id === id);
  if (!current) throw new HttpError(404, "not_found", "وصف الأصل غير موجود.");
  const linked = resolveLinkedLabels(doc, {
    categoryId: parsed.data.categoryId || current.categoryId,
    typeId: parsed.data.typeId || current.typeId,
    nameId: parsed.data.nameId || current.nameId,
    category: parsed.data.category,
    type: parsed.data.type,
    name: parsed.data.name,
  });
  const duplicate = doc.descriptions.find(
    (item) =>
      item.id !== id &&
      item.categoryId === linked.category.id &&
      item.typeId === linked.type.id &&
      item.nameId === linked.name.id,
  );
  if (duplicate) {
    throw new HttpError(409, "duplicate_description", "هذا الوصف موجود مسبقاً في القائمة.");
  }
  current.categoryId = linked.category.id;
  current.typeId = linked.type.id;
  current.nameId = linked.name.id;
  current.category = linked.category.label;
  current.type = linked.type.label;
  current.name = linked.name.label;
  const saved = await saveCatalog(db, doc);
  return { context, payload: toPayload(saved) };
}

export async function updateAssetDescriptionMainImage(
  request: Request,
  descriptionId: string,
  body: unknown,
) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(descriptionId ?? "").trim();
  const parsed = mainImageBodySchema.safeParse(coerceRequestJsonBody(body));
  if (!id || !parsed.success) {
    throw new HttpError(400, "invalid_payload", "بيانات الصورة الرئيسية غير صالحة.");
  }

  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const current = doc.descriptions.find((item) => item.id === id);
  if (!current) throw new HttpError(404, "not_found", "وصف الأصل غير موجود.");

  const previousUrl = current.mainImageUrl;
  let nextUrl: string | null = null;
  if (parsed.data.imageDataUrl) {
    nextUrl = await persistAssetDescriptionMainImage(id, parsed.data.imageDataUrl);
  }
  current.mainImageUrl = nextUrl;

  try {
    const saved = await saveCatalog(db, doc);
    if (previousUrl && previousUrl !== nextUrl) {
      await removeAssetDescriptionMainImage(previousUrl);
    }
    return { context, payload: toPayload(saved) };
  } catch (error) {
    if (nextUrl) await removeAssetDescriptionMainImage(nextUrl);
    throw error;
  }
}

export async function deleteAssetDescription(request: Request, descriptionId: string) {
  const context = await resolveRequestContext(request);
  assertCompanyAdminUser(context);
  assertCsrf(request);
  const id = String(descriptionId ?? "").trim();
  if (!id) throw new HttpError(400, "invalid_payload", "معرّف وصف الأصل مطلوب.");
  const db = await getMongoDb();
  const doc = await loadOrCreateCatalog(db, context.company._id);
  const removed = doc.descriptions.find((item) => item.id === id);
  if (!removed) {
    throw new HttpError(404, "not_found", "وصف الأصل غير موجود.");
  }
  doc.descriptions = doc.descriptions.filter((item) => item.id !== id);
  const saved = await saveCatalog(db, doc);
  await removeAssetDescriptionMainImage(removed.mainImageUrl);
  return { context, payload: toPayload(saved) };
}
