import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { ObjectId, type Db, type WithId } from "mongodb";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getMongoDb } from "@/server/mongodb";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import { resolveRequestContext, type RequestContext } from "@/server/auth-tracking/context";
import type {
  UserCompanyMembershipMongoDoc,
  ValueTechProductId,
} from "@/server/auth-tracking/types";
import { catalogGrantKeys, PERMISSION_CATALOG } from "./permission-catalog";

const COLLECTION = "company_permission_profiles";
const PRODUCT_IDS = ["machine-valuation", "real-estate-valuation"] as const;
const productSchema = z.enum(PRODUCT_IDS);
const profileBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  grants: z.array(z.string().trim().min(3).max(100)).max(300),
});
const assignmentBodySchema = z.object({
  profileIds: z.array(z.string().trim().min(1)).max(30),
  effectiveGrants: z.array(z.string().trim().min(3).max(100)).max(300).optional(),
});

export interface CompanyPermissionProfileDoc {
  companyId: ObjectId;
  productId: ValueTechProductId;
  name: string;
  grants: string[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: ObjectId;
}

type PermissionProfile = WithId<CompanyPermissionProfileDoc>;

function profiles(db: Db) {
  return db.collection<CompanyPermissionProfileDoc>(COLLECTION);
}

let permissionIndexesPromise: Promise<void> | null = null;

async function ensurePermissionIndexes(db: Db) {
  permissionIndexesPromise ??= Promise.all([
    profiles(db).createIndex({ companyId: 1, productId: 1, name: 1 }, { unique: true }),
    profiles(db).createIndex(
      { companyId: 1, productId: 1, isDefault: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } },
    ),
  ]).then(() => undefined).catch((error) => {
    permissionIndexesPromise = null;
    throw error;
  });
  await permissionIndexesPromise;
}

async function auditPermissionChange(
  db: Db,
  context: RequestContext,
  request: Request,
  actionType: string,
  actionDetails: Record<string, unknown>,
) {
  if (!context.user) return;
  await getAuthCollections(db).activities.insertOne({
    activityId: randomUUID(),
    userIdentifier: context.user.username,
    userId: context.user._id.toString(),
    sessionId: context.session._id,
    actionType,
    actionDetails,
    timestamp: new Date(),
    route: request.originalUrl || request.url,
    referrer: request.header("referer") ?? null,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });
}

function parseProduct(request: Request): ValueTechProductId {
  const raw = Array.isArray(request.query?.productId)
    ? request.query.productId[0]
    : request.query?.productId;
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException("يجب تحديد النظام المطلوب لإدارة صلاحياته.");
  return parsed.data;
}

function assertMember(context: RequestContext) {
  if (!context.user) throw new UnauthorizedException("يجب تسجيل الدخول.");
  if (context.isUserBlocked || context.user.isBlocked) throw new ForbiddenException("الحساب موقوف.");
  if (!context.company || !context.companyMembership) throw new ForbiddenException("عضوية الشركة مطلوبة.");
}

function assertAdmin(context: RequestContext) {
  assertMember(context);
  if (context.companyMembership!.role !== "company_admin") {
    throw new ForbiddenException("إدارة الصلاحيات متاحة لمدير الشركة فقط.");
  }
}

function assertCsrf(request: Request, context: RequestContext) {
  const token = request.header("x-csrf-token") ?? "";
  if (!token || token !== context.cookieState.csrfToken) {
    throw new ForbiddenException("رمز الحماية غير صالح. حدّث الصفحة وحاول مرة أخرى.");
  }
}

function normalizeGrants(productId: ValueTechProductId, grants: string[]) {
  const allowed = new Set(catalogGrantKeys(productId));
  return [...new Set(grants)].filter((grant) => allowed.has(grant));
}

async function ensureDefaultProfile(
  db: Db,
  companyId: ObjectId,
  productId: ValueTechProductId,
  actorId: ObjectId,
): Promise<PermissionProfile> {
  const collection = profiles(db);
  await ensurePermissionIndexes(db);
  const now = new Date();
  const allGrants = catalogGrantKeys(productId);
  await collection.updateOne(
    { companyId, productId, isDefault: true },
    {
      $set: { grants: allGrants, updatedAt: now },
      $setOnInsert: {
        companyId,
        productId,
        name: "الصلاحية الافتراضية",
        isDefault: true,
        createdAt: now,
        createdByUserId: actorId,
      },
    },
    { upsert: true },
  );
  return (await collection.findOne({ companyId, productId, isDefault: true }))!;
}

function serializeProfile(row: PermissionProfile) {
  return {
    id: row._id.toString(),
    name: row.name,
    grants: row.grants,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function profileIdsFor(
  membership: UserCompanyMembershipMongoDoc,
  productId: ValueTechProductId,
): string[] {
  const value = membership.permissionProfileIds?.[productId];
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string"))] : [];
}

export async function effectivePermissionGrants(
  db: Db,
  context: RequestContext,
  productId: ValueTechProductId,
): Promise<string[] | null> {
  assertMember(context);
  if (context.user!.role === "super_admin" || context.companyMembership!.role === "company_admin") {
    return null;
  }
  const defaultProfile = await ensureDefaultProfile(
    db,
    context.company!._id,
    productId,
    context.user!._id,
  );
  const assignedIds = profileIdsFor(context.companyMembership!, productId);
  const objectIds = assignedIds.flatMap((id) => (ObjectId.isValid(id) ? [new ObjectId(id)] : []));
  const assigned = objectIds.length
    ? await profiles(db).find({ _id: { $in: objectIds }, companyId: context.company!._id, productId }).toArray()
    : [defaultProfile];
  const base = new Set((assigned.length ? assigned : [defaultProfile]).flatMap((row) => row.grants));
  const overrides = context.companyMembership!.permissionOverrides?.[productId];
  for (const grant of overrides?.allow ?? []) base.add(grant);
  for (const grant of overrides?.deny ?? []) base.delete(grant);
  return normalizeGrants(productId, [...base]);
}

export async function listPermissionProfiles(request: Request) {
  const context = await resolveRequestContext(request);
  assertAdmin(context);
  const productId = parseProduct(request);
  const db = await getMongoDb();
  await ensureDefaultProfile(db, context.company!._id, productId, context.user!._id);
  const rows = await profiles(db)
    .find({ companyId: context.company!._id, productId })
    .sort({ isDefault: -1, name: 1 })
    .toArray();
  return {
    context,
    payload: { productId, catalog: PERMISSION_CATALOG[productId] ?? [], profiles: rows.map(serializeProfile) },
  };
}

export async function getMyEffectivePermissions(request: Request) {
  const context = await resolveRequestContext(request);
  assertMember(context);
  const productId = parseProduct(request);
  const db = await getMongoDb();
  const grants = await effectivePermissionGrants(db, context, productId);
  return { context, payload: { productId, unrestricted: grants === null, grants: grants ?? catalogGrantKeys(productId) } };
}

export async function createPermissionProfile(request: Request, body: unknown) {
  const context = await resolveRequestContext(request);
  assertAdmin(context);
  assertCsrf(request, context);
  const productId = parseProduct(request);
  const parsed = profileBodySchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException("راجع اسم الصلاحية والخيارات المحددة.");
  const db = await getMongoDb();
  await ensureDefaultProfile(db, context.company!._id, productId, context.user!._id);
  const now = new Date();
  try {
    const result = await profiles(db).insertOne({
      companyId: context.company!._id,
      productId,
      name: parsed.data.name,
      grants: normalizeGrants(productId, parsed.data.grants),
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      createdByUserId: context.user!._id,
    });
    const row = await profiles(db).findOne({ _id: result.insertedId });
    await auditPermissionChange(db, context, request, "permission_profile_created", {
      companyId: context.company!._id.toString(), productId, profileId: result.insertedId.toString(), name: parsed.data.name,
    });
    return { context, payload: { profile: serializeProfile(row!) } };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ConflictException("يوجد صلاحية بنفس الاسم داخل هذا النظام.");
    throw error;
  }
}

export async function updatePermissionProfile(request: Request, id: string, body: unknown) {
  const context = await resolveRequestContext(request);
  assertAdmin(context);
  assertCsrf(request, context);
  const productId = parseProduct(request);
  const parsed = profileBodySchema.safeParse(body);
  if (!parsed.success || !ObjectId.isValid(id)) throw new BadRequestException("بيانات الصلاحية غير صالحة.");
  const db = await getMongoDb();
  const current = await profiles(db).findOne({ _id: new ObjectId(id), companyId: context.company!._id, productId });
  if (!current) throw new NotFoundException("الصلاحية غير موجودة.");
  if (current.isDefault) throw new BadRequestException("الصلاحية الافتراضية محمية لضمان استمرار الوصول الحالي.");
  try {
    await profiles(db).updateOne(
      { _id: current._id },
      { $set: { name: parsed.data.name, grants: normalizeGrants(productId, parsed.data.grants), updatedAt: new Date() } },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ConflictException("يوجد صلاحية بنفس الاسم داخل هذا النظام.");
    throw error;
  }
  const row = await profiles(db).findOne({ _id: current._id });
  await auditPermissionChange(db, context, request, "permission_profile_updated", {
    companyId: context.company!._id.toString(), productId, profileId: current._id.toString(), name: parsed.data.name,
  });
  return { context, payload: { profile: serializeProfile(row!) } };
}

export async function deletePermissionProfile(request: Request, id: string) {
  const context = await resolveRequestContext(request);
  assertAdmin(context);
  assertCsrf(request, context);
  const productId = parseProduct(request);
  if (!ObjectId.isValid(id)) throw new BadRequestException("معرف الصلاحية غير صالح.");
  const db = await getMongoDb();
  const row = await profiles(db).findOne({ _id: new ObjectId(id), companyId: context.company!._id, productId });
  if (!row) throw new NotFoundException("الصلاحية غير موجودة.");
  if (row.isDefault) throw new BadRequestException("لا يمكن حذف الصلاحية الافتراضية.");
  await profiles(db).deleteOne({ _id: row._id });
  const field = `permissionProfileIds.${productId}`;
  await getAuthCollections(db).userCompanyMemberships.updateMany(
    { companyId: context.company!._id, [field]: id },
    { $pull: { [field]: id } } as never,
  );
  await auditPermissionChange(db, context, request, "permission_profile_deleted", {
    companyId: context.company!._id.toString(), productId, profileId: id, name: row.name,
  });
  return { context, payload: { ok: true } };
}

export async function updateUserPermissionAssignment(request: Request, userId: string, body: unknown) {
  const context = await resolveRequestContext(request);
  assertAdmin(context);
  assertCsrf(request, context);
  const productId = parseProduct(request);
  const parsed = assignmentBodySchema.safeParse(body);
  if (!parsed.success || !ObjectId.isValid(userId)) throw new BadRequestException("بيانات صلاحيات المستخدم غير صالحة.");
  const db = await getMongoDb();
  const memberships = getAuthCollections(db).userCompanyMemberships;
  const membership = await memberships.findOne({ companyId: context.company!._id, userId: new ObjectId(userId) });
  if (!membership) throw new NotFoundException("المستخدم غير موجود داخل الشركة.");
  if (membership.role === "company_admin") throw new BadRequestException("مدير الشركة يملك جميع الصلاحيات ولا يحتاج إلى إسناد.");
  const requested = [...new Set(parsed.data.profileIds)];
  const objectIds = requested.flatMap((id) => (ObjectId.isValid(id) ? [new ObjectId(id)] : []));
  const validRows = objectIds.length
    ? await profiles(db).find({ _id: { $in: objectIds }, companyId: context.company!._id, productId }).toArray()
    : [];
  if (validRows.length !== requested.length) throw new BadRequestException("إحدى الصلاحيات المختارة لا تخص هذا النظام أو الشركة.");
  const baseRows = validRows.length
    ? validRows
    : [await ensureDefaultProfile(db, context.company!._id, productId, context.user!._id)];
  const base = new Set(baseRows.flatMap((row) => row.grants));
  const desired = new Set(normalizeGrants(productId, parsed.data.effectiveGrants ?? [...base]));
  const allow = [...desired].filter((grant) => !base.has(grant));
  const deny = [...base].filter((grant) => !desired.has(grant));
  await memberships.updateOne(
    { _id: membership._id },
    {
      $set: {
        [`permissionProfileIds.${productId}`]: requested,
        [`permissionOverrides.${productId}`]: { allow, deny },
        updatedAt: new Date(),
      },
    },
  );
  await auditPermissionChange(db, context, request, "user_permissions_updated", {
    companyId: context.company!._id.toString(), productId, targetUserId: userId,
    profileIds: requested, allowCount: allow.length, denyCount: deny.length,
  });
  return { context, payload: { ok: true, profileIds: requested, effectiveGrants: [...desired] } };
}

