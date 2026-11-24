/**
 * سلة محذوفات نظام تقييم الآلات والمعدات.
 *
 * كل حذف داخل النظام ينقل العنصر إلى هنا بدل إتلافه، مع «عنوان» موضعه الأصلي
 * ليعود إليه عند الاستعادة:
 *  - مستندات كاملة (أصل، شيت، مجلد…): تُنقل إلى ‎`mv_trash_docs`‎ وتُعاد بنفس ‎`_id`‎.
 *  - ملفات ‎`mv_files`‎: تبقى في التخزين وتُفصل عن مشروعها (‎`metadata.trashId`‎)
 *    فتختفي من كل استعلامات المشروع دون تعديلها.
 *  - عناصر مضمّنة داخل مستند (حقل تقرير، موقع معاينة، نموذج…): يُحفظ العنصر
 *    ومساره وترتيبه، ويُعاد إدراجه في المكان نفسه.
 * المشاريع تبقى على منطقها (‎`deletedAt`‎ في ‎`mv_projects`‎) وتُدمج في العرض.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { GridFSBucket, ObjectId, type Db, type Document, type Filter } from "mongodb";

export const MV_TRASH_COLLECTION = "mv_trash";
export const MV_TRASH_DOCS_COLLECTION = "mv_trash_docs";
/** مهلة الاستعادة لمستخدمي الشركة ومديرها؛ بعدها تبقى للسوبر أدمن حتى الحذف النهائي. */
export const MV_TRASH_COMPANY_RESTORE_DAYS = 30;
const MV_FILES_FILES = "mv_files.files";
const MV_FILES_BUCKET_NAME = "mv_files";
const MV_PROJECTS = "mv_projects";
const BUSY_STALE_MS = 60 * 60 * 1000;
const DOC_INSERT_CHUNK = 500;

export type MvTrashActor = {
  userId: string | null;
  companyId: string | null;
  isSuperAdmin: boolean;
  userRole: string | null;
};

/** خطوة في مسار عنصر مضمّن: ‎`id`‎ يحدد عنصر المصفوفة السابقة الذي ننزل داخله قبل قراءة ‎`field`‎. */
export type MvEmbeddedStep = { field: string; id?: string; idKey?: string };

export type MvEmbeddedAddress = {
  collection: string;
  docId: ObjectId | string;
  path: MvEmbeddedStep[];
  index: number;
  /** مفتاح هوية العنصر؛ ‎`$value`‎ لمصفوفات القيم البسيطة. */
  idKey: string;
};

export interface MvTrashEntry {
  _id: ObjectId;
  kind: string;
  label: string;
  /** وصف مقروء للموضع الأصلي (مثل: مجلد «س» ← أصل «ص»). */
  location?: string | null;
  companyId: ObjectId | null;
  projectId?: ObjectId | null;
  deletedBy: ObjectId | null;
  deletedAt: Date;
  purgeAt: Date;
  /** عدد العناصر التي يمثلها السجل (حذف جماعي أو مجلد بمحتوياته). */
  count: number;
  hasDocs?: boolean;
  hasFiles?: boolean;
  embedded?: MvEmbeddedAddress | null;
  data: Record<string, unknown>;
  busyAt?: Date | null;
}

export type MvTrashPayloadRow = { role: string; collection?: string; doc: unknown };

export type MvTrashKindHooks = {
  /** يُستدعى قبل أي تعديل؛ يرمي ‎BadRequest‎ إن تعذرت الاستعادة (أب محذوف مثلاً). */
  beforeRestore?: (db: Db, entry: MvTrashEntry, actor: MvTrashActor) => Promise<void>;
  /** استعادة خاصة بالنوع، بعد إعادة المستندات والملفات والعنصر المضمّن. */
  restore?: (db: Db, entry: MvTrashEntry, payload: MvTrashPayloadRow[], actor: MvTrashActor) => Promise<void>;
  /** إتلاف ما يخص النوع نهائياً (ملفات خارج ‎mv_files‎ مثلاً). */
  purge?: (db: Db, entry: MvTrashEntry, payload: MvTrashPayloadRow[]) => Promise<void>;
  /** لا يُشترط أن يكون المشروع نشطاً (عناصر لا تسكن داخل مشروع). */
  skipProjectCheck?: boolean;
};

const kindHooks = new Map<string, MvTrashKindHooks>();
export function registerMvTrashKind(kind: string, hooks: MvTrashKindHooks) {
  kindHooks.set(kind, hooks);
}

const restoreListeners = new Set<(entry: MvTrashEntry) => unknown>();
/** يُستدعى بعد كل استعادة ناجحة (لإبطال ذاكرات مؤقتة تخص مجموعات أخرى مثلاً). */
export function onMvTrashRestored(listener: (entry: MvTrashEntry) => unknown) {
  restoreListeners.add(listener);
}

const runtime: { deleteSpacesObject?: (key: string) => Promise<void> } = {};
/** تُهيّأ من خدمة النظام لتمكين إتلاف كائنات ‎Spaces‎ عند الحذف النهائي. */
export function configureMvTrash(options: { deleteSpacesObject?: (key: string) => Promise<void> }) {
  if (options.deleteSpacesObject) runtime.deleteSpacesObject = options.deleteSpacesObject;
}

export function mvTrashObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && ObjectId.isValid(value.trim())) return new ObjectId(value.trim());
  return null;
}

/** يبني هوية منفّذ الحذف من سياق الطلب (للخدمات خارج متحكم النظام). */
export function mvTrashActorFromContext(context: {
  user?: { _id: ObjectId; role: string } | null;
  company?: { _id: ObjectId } | null;
}): MvTrashActor {
  return {
    userId: context.user?._id.toString() ?? null,
    companyId: context.company?._id.toString() ?? null,
    isSuperAdmin: context.user?.role === "super_admin",
    userRole: context.user?.role ?? null,
  };
}

/** هل الطلب صادر من داخل نظام تقييم الآلات والمعدات؟ (‎`?productId=machine-valuation`‎) */
export function isMvProductRequest(request: { query?: Record<string, unknown>; body?: unknown }): boolean {
  const fromQuery = Array.isArray(request.query?.productId) ? request.query.productId[0] : request.query?.productId;
  const fromBody = (request.body as { productId?: unknown } | undefined)?.productId;
  return (fromQuery ?? fromBody) === "machine-valuation";
}

export function addMvTrashDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMvTrashYears(value: Date, years: number): Date {
  const result = new Date(value);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

export function isMvTrashAdmin(actor: MvTrashActor) {
  return actor.isSuperAdmin || actor.userRole === "company_admin";
}

/** آخر موعد يستطيع فيه هذا المستخدم استعادة عنصر حُذف في ‎`deletedAt`‎. */
export function mvTrashRestoreUntil(deletedAt: Date, actor: MvTrashActor): Date {
  return actor.isSuperAdmin
    ? addMvTrashYears(deletedAt, 1)
    : addMvTrashDays(deletedAt, MV_TRASH_COMPANY_RESTORE_DAYS);
}

let indexesReady: Promise<void> | undefined;
export function ensureMvTrashIndexes(db: Db): Promise<void> {
  if (!indexesReady) {
    indexesReady = Promise.all([
      db.collection(MV_TRASH_COLLECTION).createIndex({ companyId: 1, deletedAt: -1 }),
      db.collection(MV_TRASH_COLLECTION).createIndex({ deletedBy: 1, deletedAt: -1 }),
      db.collection(MV_TRASH_COLLECTION).createIndex({ projectId: 1 }),
      db.collection(MV_TRASH_COLLECTION).createIndex({ purgeAt: 1 }),
      db.collection(MV_TRASH_DOCS_COLLECTION).createIndex({ trashId: 1 }),
      db.collection(MV_FILES_FILES).createIndex({ "metadata.trashId": 1 }, { sparse: true }),
      db.collection(MV_FILES_FILES).createIndex({ "metadata.trashedProjectId": 1 }, { sparse: true }),
    ]).then(() => undefined).catch((error) => { indexesReady = undefined; throw error; });
  }
  return indexesReady;
}

export type CreateMvTrashInput = {
  _id?: ObjectId;
  kind: string;
  label: string;
  location?: string | null;
  projectId?: ObjectId | null;
  /** شركة العنصر؛ الافتراضي شركة المستخدم النشطة. */
  companyId?: ObjectId | string | null;
  count?: number;
  data?: Record<string, unknown>;
  embedded?: MvEmbeddedAddress | null;
  /** مستندات كاملة تُعاد إلى مجموعاتها عند الاستعادة. */
  docs?: Array<{ collection: string; doc: Document }>;
  /** حمولة إضافية يقرؤها خطاف النوع (أو العنصر المضمّن بدور ‎`item`‎). */
  payload?: MvTrashPayloadRow[];
  hasFiles?: boolean;
};

function clampLabel(value: unknown, fallback: string): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 300);
}

/**
 * يسجّل عنصراً في السلة. يُستدعى قبل إزالة العنصر من موضعه الحي حتى لا يضيع
 * شيء إن انقطع التنفيذ بين الخطوتين (الاستعادة تتجاهل ما هو موجود أصلاً).
 */
export async function createMvTrashEntry(db: Db, actor: MvTrashActor, input: CreateMvTrashInput): Promise<ObjectId> {
  await ensureMvTrashIndexes(db);
  const _id = input._id ?? new ObjectId();
  const deletedAt = new Date();
  const rows: Array<{ trashId: ObjectId; role: string; collection?: string; doc: unknown }> = [
    ...(input.docs ?? []).map((row) => ({ trashId: _id, role: "doc", collection: row.collection, doc: row.doc })),
    ...(input.payload ?? []).map((row) => ({ trashId: _id, role: row.role, collection: row.collection, doc: row.doc })),
  ];
  for (let offset = 0; offset < rows.length; offset += DOC_INSERT_CHUNK) {
    await db.collection(MV_TRASH_DOCS_COLLECTION).insertMany(rows.slice(offset, offset + DOC_INSERT_CHUNK), { ordered: false });
  }
  const entry: MvTrashEntry = {
    _id,
    kind: input.kind,
    label: clampLabel(input.label, input.kind),
    location: input.location ? clampLabel(input.location, "") : null,
    companyId: input.companyId !== undefined ? mvTrashObjectId(input.companyId) : mvTrashObjectId(actor.companyId),
    projectId: input.projectId ?? null,
    deletedBy: mvTrashObjectId(actor.userId),
    deletedAt,
    purgeAt: addMvTrashYears(deletedAt, 1),
    count: Math.max(1, input.count ?? 1),
    hasDocs: (input.docs?.length ?? 0) > 0,
    hasFiles: input.hasFiles === true,
    embedded: input.embedded ?? null,
    data: input.data ?? {},
    busyAt: null,
  };
  await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION).insertOne(entry);
  return _id;
}

/** يلغي سجلاً أُنشئ ثم تبيّن أن الحذف لم يتم (لا شيء حُذف فعلاً). */
export async function discardMvTrashEntry(db: Db, trashId: ObjectId) {
  await db.collection(MV_TRASH_DOCS_COLLECTION).deleteMany({ trashId });
  await db.collection(MV_TRASH_COLLECTION).deleteOne({ _id: trashId });
}

/* ───────── ملفات mv_files ───────── */

/** يفصل الملفات عن مشروعها فتختفي من كل استعلام يعتمد ‎`metadata.projectId`‎ مع بقاء محتواها. */
export async function detachMvFilesToTrash(db: Db, trashId: ObjectId, filter: Record<string, unknown>): Promise<number> {
  await ensureMvTrashIndexes(db);
  const result = await db.collection(MV_FILES_FILES).updateMany(
    filter,
    [
      { $set: { "metadata.trashId": trashId, "metadata.trashedProjectId": "$metadata.projectId" } },
      { $unset: "metadata.projectId" },
    ],
  );
  return result.modifiedCount;
}

async function reattachMvFiles(db: Db, trashId: ObjectId) {
  await db.collection(MV_FILES_FILES).updateMany(
    { "metadata.trashId": trashId },
    [
      { $set: { "metadata.projectId": "$metadata.trashedProjectId" } },
      { $unset: ["metadata.trashId", "metadata.trashedProjectId"] },
    ],
  );
}

/** إتلاف نهائي لملفات مفصولة (محتوى ‎GridFS‎ أو كائن ‎Spaces‎ ثم سجل الملف). */
export async function purgeDetachedMvFiles(db: Db, filter: Record<string, unknown>): Promise<number> {
  const files = await db
    .collection<{ _id: ObjectId; metadata?: { storage?: string; spacesKey?: string } }>(MV_FILES_FILES)
    .find(filter, { projection: { _id: 1, metadata: 1 } })
    .toArray();
  const bucket = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET_NAME });
  for (const file of files) {
    const key = file.metadata?.storage === "digitalocean" ? file.metadata.spacesKey?.trim() : "";
    if (key) {
      await runtime.deleteSpacesObject?.(key).catch(() => undefined);
      await db.collection(MV_FILES_FILES).deleteOne({ _id: file._id });
    } else {
      await bucket.delete(file._id).catch(() => undefined);
    }
  }
  return files.length;
}

/* ───────── العناصر المضمّنة ───────── */

export type MvEmbeddedSpec = {
  /** مسار المصفوفة داخل الأب (يقبل النقاط: ‎`reportData.customFields`‎). */
  field: string;
  kind: string;
  idKey?: string;
  labelKeys?: string[];
  children?: MvEmbeddedSpec[];
};

export type MvEmbeddedRemoval = {
  kind: string;
  label: string;
  path: MvEmbeddedStep[];
  index: number;
  idKey: string;
  item: unknown;
  /** أسماء الآباء من الأعلى للأسفل، لوصف الموضع. */
  parents: string[];
  /** عناصر تابعة حُذفت معه وتُستعاد معه في سجل واحد. */
  extras?: MvEmbeddedRemoval[];
  /** بيانات إضافية يقرؤها خطاف النوع عند الاستعادة. */
  data?: Record<string, unknown>;
};

/** يضم العناصر التابعة إلى آبائها المحذوفين في الطلب نفسه (سجل واحد يستعيد الجميع). */
export function groupEmbeddedRemovals(
  removals: MvEmbeddedRemoval[],
  isChildOf: (child: MvEmbeddedRemoval, parent: MvEmbeddedRemoval) => boolean,
): MvEmbeddedRemoval[] {
  const absorbed = new Set<MvEmbeddedRemoval>();
  for (const parent of removals) {
    for (const child of removals) {
      if (child === parent || absorbed.has(child) || absorbed.has(parent)) continue;
      if (!isChildOf(child, parent)) continue;
      (parent.extras ??= []).push(child);
      absorbed.add(child);
    }
  }
  return removals.filter((removal) => !absorbed.has(removal));
}

function readPath(root: unknown, path: string): unknown {
  let cursor = root;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function itemIdentity(item: unknown, idKey: string): string | null {
  if (idKey === "$value") {
    return typeof item === "string" || typeof item === "number" ? String(item) : null;
  }
  if (!item || typeof item !== "object") return null;
  const raw = (item as Record<string, unknown>)[idKey];
  if (raw instanceof ObjectId) return raw.toString();
  if (typeof raw === "string" || typeof raw === "number") {
    const text = String(raw).trim();
    return text || null;
  }
  return null;
}

function itemLabel(item: unknown, labelKeys: string[] | undefined, fallback: string): string {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (item && typeof item === "object") {
    for (const key of labelKeys ?? ["name", "label", "title"]) {
      const value = readPath(item, key);
      if (typeof value === "string" && value.trim()) return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (typeof value === "number") return String(value);
    }
  }
  return fallback;
}

/**
 * يقارن نسختين من مستند ويعيد العناصر التي اختفت من المصفوفات المعرّفة.
 * لا يُسجَّل حذف الأبناء حين يُحذف أبوهم (يعودون معه)، ولا تُتابع مصفوفة
 * تفتقر عناصرها لهوية ثابتة أو لم تُرسل أصلاً في النسخة الجديدة.
 */
export function diffRemovedEmbeddedItems(
  previous: unknown,
  next: unknown,
  specs: MvEmbeddedSpec[],
): MvEmbeddedRemoval[] {
  return diffEmbeddedLevel(previous, next, specs, [], null, []);
}

function diffEmbeddedLevel(
  previous: unknown,
  next: unknown,
  specs: MvEmbeddedSpec[],
  prefix: MvEmbeddedStep[],
  /** عنصر المصفوفة السابقة الذي نقف داخله (غير موجود عند الجذر). */
  within: { id: string; idKey: string } | null,
  parents: string[],
): MvEmbeddedRemoval[] {
  const removals: MvEmbeddedRemoval[] = [];
  for (const spec of specs) {
    const idKey = spec.idKey ?? "id";
    const before = readPath(previous, spec.field);
    const after = readPath(next, spec.field);
    if (!Array.isArray(before) || before.length === 0) continue;
    if (after !== undefined && after !== null && !Array.isArray(after)) continue;
    const afterById = new Map<string, unknown>();
    for (const item of Array.isArray(after) ? after : []) {
      const id = itemIdentity(item, idKey);
      if (id) afterById.set(id, item);
    }
    const path: MvEmbeddedStep[] = [
      ...prefix,
      within ? { field: spec.field, id: within.id, idKey: within.idKey } : { field: spec.field },
    ];
    const seen = new Set<string>();
    before.forEach((item, index) => {
      const id = itemIdentity(item, idKey);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const label = itemLabel(item, spec.labelKeys, spec.kind);
      if (!afterById.has(id)) {
        removals.push({ kind: spec.kind, label, path, index, idKey, item, parents });
        return;
      }
      if (spec.children?.length) {
        removals.push(...diffEmbeddedLevel(
          item, afterById.get(id), spec.children, path, { id, idKey }, [...parents, label],
        ));
      }
    });
  }
  return removals;
}

/**
 * يعيد إدراج عنصر في مساره داخل ‎`root`‎ (تعديل في المكان).
 * يعيد ‎`"missing-parent"`‎ إذا اختفى أحد الآباء، و‎`"exists"`‎ إن كان العنصر موجوداً.
 */
export function insertEmbeddedItem(
  root: Record<string, unknown>,
  address: Pick<MvEmbeddedAddress, "path" | "index" | "idKey">,
  item: unknown,
): "inserted" | "exists" | "missing-parent" {
  let cursor: unknown = root;
  for (let stepIndex = 0; stepIndex < address.path.length; stepIndex++) {
    const step = address.path[stepIndex]!;
    if (step.id !== undefined) {
      if (!Array.isArray(cursor)) return "missing-parent";
      const parent = cursor.find((candidate) => itemIdentity(candidate, step.idKey ?? "id") === step.id);
      if (!parent || typeof parent !== "object") return "missing-parent";
      cursor = parent;
    }
    if (!cursor || typeof cursor !== "object") return "missing-parent";
    const parts = step.field.split(".");
    let holder = cursor as Record<string, unknown>;
    for (let partIndex = 0; partIndex < parts.length - 1; partIndex++) {
      const part = parts[partIndex]!;
      const nextHolder = holder[part];
      if (!nextHolder || typeof nextHolder !== "object" || Array.isArray(nextHolder)) {
        if (nextHolder != null) return "missing-parent";
        holder[part] = {};
      }
      holder = holder[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1]!;
    if (holder[leaf] == null) holder[leaf] = [];
    if (!Array.isArray(holder[leaf])) return "missing-parent";
    cursor = holder[leaf];
  }
  const list = cursor as unknown[];
  const identity = itemIdentity(item, address.idKey);
  if (identity && list.some((candidate) => itemIdentity(candidate, address.idKey) === identity)) return "exists";
  list.splice(Math.max(0, Math.min(address.index, list.length)), 0, item);
  return "inserted";
}

/** يعيد عنصراً مضمّناً إلى مستنده. ‎`strict`‎: يرمي خطأً إن غاب المستند أو الأب، وإلا يتجاوز بصمت. */
async function insertEmbeddedIntoDoc(db: Db, address: MvEmbeddedAddress, item: unknown, strict: boolean) {
  const topField = address.path[0]!.field.split(".")[0]!;
  const docId = mvTrashObjectId(address.docId) ?? address.docId;
  const collection = db.collection<Document>(address.collection);
  const doc = await collection.findOne({ _id: docId as never }, { projection: { [topField]: 1 } });
  if (!doc) {
    if (strict) throw new BadRequestException("الموضع الأصلي لهذا العنصر لم يعد موجوداً.");
    return;
  }
  const outcome = insertEmbeddedItem(doc, address, item);
  if (outcome === "missing-parent" && strict) {
    throw new BadRequestException("العنصر الأب لهذا العنصر محذوف. استعد الأب أولاً ثم أعد المحاولة.");
  }
  if (outcome === "inserted") {
    await collection.updateOne({ _id: docId as never }, { $set: { [topField]: doc[topField], updatedAt: new Date() } });
  }
}

async function restoreEmbedded(db: Db, entry: MvTrashEntry, payload: MvTrashPayloadRow[]) {
  if (entry.embedded) {
    const item = payload.find((row) => row.role === "item");
    if (!item) throw new BadRequestException("بيانات العنصر المحذوف غير متاحة للاستعادة.");
    await insertEmbeddedIntoDoc(db, entry.embedded, item.doc, true);
  }
  // عناصر تابعة حُذفت مع العنصر الأساسي (حقول قسم، صور ملف…) تعود معه.
  for (const row of payload) {
    if (row.role !== "embeddedExtra" || !row.doc || typeof row.doc !== "object") continue;
    const extra = row.doc as { address?: MvEmbeddedAddress; item?: unknown };
    if (extra.address) await insertEmbeddedIntoDoc(db, extra.address, extra.item, false);
  }
}

/** يحوّل نتائج المقارنة إلى سجلات في السلة (سجل لكل عنصر محذوف). */
export async function trashEmbeddedRemovals(
  db: Db,
  actor: MvTrashActor,
  target: {
    collection: string;
    docId: ObjectId | string;
    projectId?: ObjectId | null;
    companyId?: ObjectId | string | null;
    location?: string | null;
    data?: Record<string, unknown>;
  },
  removals: MvEmbeddedRemoval[],
): Promise<ObjectId[]> {
  const ids: ObjectId[] = [];
  for (const removal of removals) {
    const where = [target.location, ...removal.parents].filter(Boolean).join(" ← ");
    const addressOf = (row: MvEmbeddedRemoval): MvEmbeddedAddress => ({
      collection: target.collection,
      docId: target.docId,
      path: row.path,
      index: row.index,
      idKey: row.idKey,
    });
    // التوابع تُعاد بترتيب مواضعها الأصلية حتى لا تنزاح فهارسها.
    const extras = [...(removal.extras ?? [])].sort((a, b) => a.index - b.index);
    ids.push(await createMvTrashEntry(db, actor, {
      kind: removal.kind,
      label: removal.label,
      location: where || null,
      projectId: target.projectId ?? null,
      ...(target.companyId !== undefined ? { companyId: target.companyId } : {}),
      count: 1 + extras.length,
      data: { ...(target.data ?? {}), ...(removal.data ?? {}) },
      embedded: addressOf(removal),
      payload: [
        { role: "item", doc: removal.item },
        ...extras.map((extra) => ({ role: "embeddedExtra", doc: { address: addressOf(extra), item: extra.item } })),
      ],
    }));
  }
  return ids;
}

/* ───────── العرض والاستعادة والحذف النهائي ───────── */

/** مدير الشركة يرى محذوفات كل مستخدمي شركته؛ غيره يرى ما حذفه بنفسه فقط. */
export function mvTrashVisibilityFilter(actor: MvTrashActor): Filter<MvTrashEntry> {
  if (!actor.userId) throw new ForbiddenException("يجب تسجيل الدخول لعرض سلة المحذوفات.");
  if (actor.isSuperAdmin) return {};
  const companyId = mvTrashObjectId(actor.companyId);
  if (!companyId) throw new ForbiddenException("غير مصرح بعرض سلة المحذوفات.");
  if (actor.userRole === "company_admin") return { companyId };
  const userId = mvTrashObjectId(actor.userId);
  if (!userId) throw new ForbiddenException("غير مصرح بعرض سلة المحذوفات.");
  return { companyId, deletedBy: userId };
}

export async function listMvTrashEntries(db: Db, actor: MvTrashActor): Promise<MvTrashEntry[]> {
  await ensureMvTrashIndexes(db);
  return db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
    .find(mvTrashVisibilityFilter(actor))
    .sort({ deletedAt: -1 })
    .limit(2000)
    .toArray();
}

async function loadVisibleEntry(db: Db, id: ObjectId, actor: MvTrashActor) {
  const entry = await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
    .findOne({ ...mvTrashVisibilityFilter(actor), _id: id } as Filter<MvTrashEntry>);
  if (!entry) throw new NotFoundException("العنصر غير موجود في سلة المحذوفات.");
  return entry;
}

async function claimEntry(db: Db, entry: MvTrashEntry): Promise<Date> {
  const claimedAt = new Date();
  const claimed = await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION).updateOne(
    {
      _id: entry._id,
      $or: [{ busyAt: null }, { busyAt: { $exists: false } }, { busyAt: { $lte: new Date(claimedAt.getTime() - BUSY_STALE_MS) } }],
    },
    { $set: { busyAt: claimedAt } },
  );
  if (!claimed.modifiedCount) throw new BadRequestException("هناك عملية أخرى قيد التنفيذ على هذا العنصر. حاول بعد قليل.");
  return claimedAt;
}

async function loadPayload(db: Db, trashId: ObjectId): Promise<MvTrashPayloadRow[]> {
  return db.collection<MvTrashPayloadRow & { trashId: ObjectId }>(MV_TRASH_DOCS_COLLECTION)
    .find({ trashId }).toArray();
}

async function assertProjectActive(db: Db, projectId: ObjectId) {
  const project = await db.collection(MV_PROJECTS).findOne({ _id: projectId }, { projection: { deletedAt: 1 } });
  if (!project) throw new BadRequestException("المشروع الذي ينتمي إليه هذا العنصر حُذف نهائياً.");
  if (project.deletedAt) {
    throw new BadRequestException("المشروع الذي ينتمي إليه هذا العنصر موجود في سلة المحذوفات. استعد المشروع أولاً.");
  }
}

async function reinsertDocs(db: Db, payload: MvTrashPayloadRow[]) {
  const byCollection = new Map<string, Document[]>();
  for (const row of payload) {
    if (row.role !== "doc" || !row.collection || !row.doc) continue;
    const list = byCollection.get(row.collection) ?? [];
    list.push(row.doc as Document);
    byCollection.set(row.collection, list);
  }
  for (const [collection, docs] of byCollection) {
    for (let offset = 0; offset < docs.length; offset += DOC_INSERT_CHUNK) {
      const chunk = docs.slice(offset, offset + DOC_INSERT_CHUNK);
      try {
        await db.collection(collection).insertMany(chunk, { ordered: false });
      } catch (error) {
        const writeErrors = (error as { writeErrors?: Array<{ code?: number }> }).writeErrors;
        const onlyDuplicates = (error as { code?: number }).code === 11000 &&
          (!writeErrors || writeErrors.every((item) => item.code === 11000));
        if (!onlyDuplicates) throw error;
        // مستند موجود بالمعرّف نفسه (استعادة مكررة أو انقطاع سابق) لا يُعد فشلاً،
        // أما تعارض فهرس فريد آخر فمعناه أن عنصراً حياً يحتل مكانه الآن.
        const ids = chunk.map((doc) => doc._id);
        const present = await db.collection(collection).countDocuments({ _id: { $in: ids } });
        if (present < chunk.length) {
          throw new BadRequestException(
            "تعذرت استعادة بعض العناصر لوجود عناصر حالية بالمعرّف نفسه. احذف العنصر الحالي أو غيّر معرّفه ثم أعد المحاولة.",
          );
        }
      }
    }
  }
}

/** يعيد العنصر إلى موضعه الأصلي. المستخدم يستعيد ما حذفه؛ المدير يستعيد محذوفات شركته. */
export async function restoreMvTrashEntry(db: Db, id: ObjectId, actor: MvTrashActor): Promise<MvTrashEntry> {
  const entry = await loadVisibleEntry(db, id, actor);
  if (mvTrashRestoreUntil(entry.deletedAt, actor) <= new Date()) {
    throw new BadRequestException(actor.isSuperAdmin
      ? "انتهت مهلة استعادة هذا العنصر (سنة واحدة)."
      : `انتهت مهلة استعادة هذا العنصر (${MV_TRASH_COMPANY_RESTORE_DAYS} يومًا).`);
  }
  const hooks = kindHooks.get(entry.kind);
  if (entry.projectId && !hooks?.skipProjectCheck) await assertProjectActive(db, entry.projectId);
  await hooks?.beforeRestore?.(db, entry, actor);
  const claimedAt = await claimEntry(db, entry);
  try {
    const payload = await loadPayload(db, entry._id);
    await reinsertDocs(db, payload);
    if (entry.hasFiles) await reattachMvFiles(db, entry._id);
    await restoreEmbedded(db, entry, payload);
    await hooks?.restore?.(db, entry, payload, actor);
    await discardMvTrashEntry(db, entry._id);
    for (const listener of restoreListeners) {
      try { await listener(entry); } catch { /* الاستعادة تمت؛ فشل مستمع لا يلغيها. */ }
    }
    return entry;
  } catch (error) {
    await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
      .updateOne({ _id: entry._id, busyAt: claimedAt }, { $set: { busyAt: null } });
    throw error;
  }
}

async function purgeEntry(db: Db, entry: MvTrashEntry) {
  const payload = await loadPayload(db, entry._id);
  await kindHooks.get(entry.kind)?.purge?.(db, entry, payload);
  if (entry.hasFiles) await purgeDetachedMvFiles(db, { "metadata.trashId": entry._id });
  await discardMvTrashEntry(db, entry._id);
}

/** حذف نهائي لا رجعة فيه — لمدير الشركة والسوبر أدمن فقط. */
export async function purgeMvTrashEntry(db: Db, id: ObjectId, actor: MvTrashActor): Promise<MvTrashEntry> {
  if (!actor.userId || !isMvTrashAdmin(actor)) {
    throw new ForbiddenException("الحذف النهائي متاح لمدير الشركة فقط.");
  }
  const entry = await loadVisibleEntry(db, id, actor);
  const claimedAt = await claimEntry(db, entry);
  try {
    await purgeEntry(db, entry);
    return entry;
  } catch (error) {
    await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
      .updateOne({ _id: entry._id, busyAt: claimedAt }, { $set: { busyAt: null } });
    throw error;
  }
}

/** يتلف ما انتهت مدة احتفاظه (سنة). يُستدعى دورياً مع تنظيف المشاريع. */
export async function purgeExpiredMvTrash(db: Db, limit = 200): Promise<number> {
  await ensureMvTrashIndexes(db);
  const now = new Date();
  const expired = await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
    .find({ purgeAt: { $lte: now } }).limit(limit).toArray();
  let purged = 0;
  for (const entry of expired) {
    try {
      await claimEntry(db, entry);
      await purgeEntry(db, entry);
      purged++;
    } catch {
      await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION)
        .updateOne({ _id: entry._id }, { $set: { busyAt: null } }).catch(() => undefined);
    }
  }
  return purged;
}

/** عند إتلاف مشروع نهائياً تُتلف معه كل محذوفاته التي ما زالت في السلة. */
export async function purgeMvTrashForProject(db: Db, projectId: ObjectId): Promise<void> {
  const entries = await db.collection<MvTrashEntry>(MV_TRASH_COLLECTION).find({ projectId }).toArray();
  for (const entry of entries) await purgeEntry(db, entry).catch(() => undefined);
  await purgeDetachedMvFiles(db, { "metadata.trashedProjectId": projectId });
}
