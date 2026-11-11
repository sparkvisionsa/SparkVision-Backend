import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { getMongoDb } from "@/server/mongodb";
import { TRANSACTIONS_COLLECTION } from "../transactions/transactions.model"; // adjust path
import {
  COMPANY_DEFAULTS_COLLECTION,
  DEFAULT_PRODUCT_ID,
  type CompanyDefaultsDoc,
} from "./default-values.model";
import {
  type AssignmentNumberConfig,
  DEFAULT_ASSIGNMENT_CONFIG,
  generateAssignmentNumber,
  sequenceCapacity,
} from "@/lib/assignment-number";
import { sanitizeValues, buildResolved } from "./default-fields";

const MAX_ATTEMPTS = 25;

// ─── helpers ──────────────────────────────────────────────────────────────────

function riyadhDate(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}
const riyadhToday = () => riyadhDate(new Date());

function periodKey(cfg: AssignmentNumberConfig, d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  switch (cfg.reset) {
    case "yearly": return y;
    case "monthly": return `${y}-${m}`;
    case "daily": return `${y}-${m}-${day}`;
    default: return "all";
  }
}

function sanitizeProductId(v: unknown): string {
  return typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v) ? v : DEFAULT_PRODUCT_ID;
}

function sanitizeConfig(raw: unknown): AssignmentNumberConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const D = DEFAULT_ASSIGNMENT_CONFIG;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T =>
    allowed.includes(v as T) ? (v as T) : fb;
  const int = (v: unknown, min: number, max: number, fb: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);

  return {
    enabled: bool(r.enabled, D.enabled),
    source: pick(r.source, ["sequence", "date", "both"] as const, D.source),
    charset: pick(r.charset, ["digits", "letters", "alphanumeric"] as const, D.charset),
    incremental: bool(r.incremental, D.incremental),
    length: int(r.length, 1, 12, D.length),
    start: int(r.start, 0, Number.MAX_SAFE_INTEGER, D.start),
    reset: pick(r.reset, ["never", "yearly", "monthly", "daily"] as const, D.reset),
    dateFormat: pick(r.dateFormat, ["YYYYMMDD", "YYMMDD", "YYYYMM", "YYYY"] as const, D.dateFormat),
    prefix: typeof r.prefix === "string" ? r.prefix.replace(/\s/g, "").slice(0, 12) : "",
    prefixDash: bool(r.prefixDash, D.prefixDash),
    partDash: bool(r.partDash, D.partDash),
  };
}

// ─── service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DefaultValuesService {
  private indexReady: Promise<unknown> | null = null;

  private async col() {
    const db = await getMongoDb();
    const col = db.collection<CompanyDefaultsDoc>(COMPANY_DEFAULTS_COLLECTION);
    if (!this.indexReady) {
      this.indexReady = col
        .createIndex({ companyId: 1, productId: 1 }, { unique: true })
        .catch(() => {
          this.indexReady = null; // retry next call
        });
    }
    await this.indexReady;
    return col;
  }

  private async numberExists(companyId: string, value: string): Promise<boolean> {
    const db = await getMongoDb();
    const hit = await db
      .collection(TRANSACTIONS_COLLECTION)
      .findOne({ companyId, assignmentNumber: value }, { projection: { _id: 1 } });
    return !!hit;
  }

  // ── settings (GET / PUT) ───────────────────────────────────────────────────

  async getSettings(companyId: string, productIdRaw?: string) {
    const productId = sanitizeProductId(productIdRaw);
    const col = await this.col();
    const doc = await col.findOne({ companyId, productId });
    return {
      assignmentNumber: { ...DEFAULT_ASSIGNMENT_CONFIG, ...(doc?.assignmentNumber ?? {}) },
      values: doc?.values ?? {},
    };
  }

  /** Defaults ready for use: "today" resolved, split into transaction form / evalData. */
  async getResolved(companyId: string, productIdRaw?: string) {
    const productId = sanitizeProductId(productIdRaw);
    const col = await this.col();
    const doc = await col.findOne({ companyId, productId });
    return buildResolved(doc?.values ?? {}, riyadhToday());
  }

  async saveSettings(companyId: string, productIdRaw: string | undefined, body: Record<string, unknown>) {
    const productId = sanitizeProductId(productIdRaw);
    const col = await this.col();
    const update: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    const now = new Date();
    let renumber: Awaited<ReturnType<DefaultValuesService["planRenumber"]>> | null = null;

    if (body.values !== undefined) {
      update.values = sanitizeValues(body.values);
    }

    if (body.assignmentNumber !== undefined) {
      const next = sanitizeConfig(body.assignmentNumber);
      const prevDoc = await col.findOne({ companyId, productId });
      const prev = prevDoc?.assignmentNumber;

      if (
        prev &&
        (prev.start !== next.start || prev.length !== next.length ||
          prev.charset !== next.charset || prev.reset !== next.reset)
      ) {
        unset["counters.assignmentNumber"] = "";
      }
      update.assignmentNumber = next;

      // Plan first (pure + validates capacity) so a failure leaves everything untouched.
      if (body.renumberExisting === true) {
        renumber = await this.planRenumber(companyId, next);
      }
    }

    await col.updateOne(
      { companyId, productId },
      {
        $set: { ...update, updatedAt: now },
        $setOnInsert: { createdAt: now },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      } as any,
      { upsert: true },
    );

    if (renumber) {
      const db = await getMongoDb();
      const tx = db.collection(TRANSACTIONS_COLLECTION);
      for (let i = 0; i < renumber.ops.length; i += 1000) {
        await tx.bulkWrite(renumber.ops.slice(i, i + 1000) as any, { ordered: false });
      }
      // Continue the sequence after the last renumbered transaction.
      await col.updateOne(
        { companyId, productId },
        { $set: { "counters.assignmentNumber": renumber.counter } } as any,
      );
    }

    return this.getSettings(companyId, productId);
  }

  /**
   * Renumber every transaction of the company, oldest first, using the new scheme.
   * Date part comes from each transaction's createdAt (Riyadh date); the counter
   * restarts per period according to `reset`.
   */
  private async planRenumber(companyId: string, cfg: AssignmentNumberConfig) {
    const ops: unknown[] = [];
    if (!cfg.enabled || !cfg.incremental || cfg.source === "date") {
      return { ops, counter: { periodKey: periodKey(cfg, riyadhToday()), next: cfg.start } };
    }
    const db = await getMongoDb();
    const rows = await db
      .collection(TRANSACTIONS_COLLECTION)
      .find({ companyId }, { projection: { _id: 1, createdAt: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();

    const cap = sequenceCapacity(cfg);
    const nextByPeriod = new Map<string, number>();

    for (const r of rows) {
      const d = riyadhDate(r.createdAt instanceof Date ? r.createdAt : new Date());
      const key = periodKey(cfg, d);
      const n = nextByPeriod.get(key) ?? cfg.start;
      if (n >= cap) {
        throw new BadRequestException({ message: "الطول المحدد لا يكفي لترقيم كل المعاملات، زد الطول" });
      }
      nextByPeriod.set(key, n + 1);
      ops.push({
        updateOne: {
          filter: { _id: r._id },
          update: { $set: { assignmentNumber: generateAssignmentNumber(cfg, { counter: n, now: d }) } },
        },
      });
    }

    const todayKey = periodKey(cfg, riyadhToday());
    return { ops, counter: { periodKey: todayKey, next: nextByPeriod.get(todayKey) ?? cfg.start } };
  }

  // ── assignment number: preview (does NOT consume) ──────────────────────────

  async previewAssignmentNumber(companyId: string, productIdRaw?: string): Promise<string | null> {
    const productId = sanitizeProductId(productIdRaw);
    const col = await this.col();
    const doc = await col.findOne({ companyId, productId });
    const cfg = doc?.assignmentNumber;
    if (!cfg?.enabled) return null;

    const today = riyadhToday();
    const hasSeq = cfg.source !== "date";

    if (!hasSeq) return generateAssignmentNumber(cfg, { counter: 0, now: today });

    if (!cfg.incremental) {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const v = generateAssignmentNumber(cfg, { counter: 0, now: today });
        if (!(await this.numberExists(companyId, v))) return v;
      }
      throw new BadRequestException({ message: "تعذر توليد رقم تكليف فريد" });
    }

    const stored = doc?.counters?.assignmentNumber;
    let n = stored && stored.periodKey === periodKey(cfg, today) ? stored.next : cfg.start;
    const cap = sequenceCapacity(cfg);
    for (let i = 0; i < MAX_ATTEMPTS; i++, n++) {
      if (n >= cap) throw new BadRequestException({ message: "تم استنفاد أرقام التكليف المتاحة، زد الطول من القيم الافتراضية" });
      const v = generateAssignmentNumber(cfg, { counter: n, now: today });
      if (!(await this.numberExists(companyId, v))) return v;
    }
    throw new BadRequestException({ message: "تعذر توليد رقم تكليف فريد" });
  }

  // ── assignment number: used by transaction creation ────────────────────────

  /** Atomically takes the next counter value (resetting it first if the period rolled over). */
  private async consumeCounter(
    companyId: string,
    productId: string,
    cfg: AssignmentNumberConfig,
    today: Date,
  ): Promise<number | null> {
    const col = await this.col();
    const key = periodKey(cfg, today);
    const path = "counters.assignmentNumber";

    // Restart for a new period. Matches when periodKey is missing or different,
    // so only one concurrent caller wins; the rest fall through to the $inc.
    await col.updateOne(
      { companyId, productId, [`${path}.periodKey`]: { $ne: key } } as any,
      { $set: { [path]: { periodKey: key, next: cfg.start } } } as any,
    );

    const before = await col.findOneAndUpdate(
      { companyId, productId, [`${path}.periodKey`]: key } as any,
      { $inc: { [`${path}.next`]: 1 } } as any,
      { returnDocument: "before" },
    );
    return before?.counters?.assignmentNumber?.next ?? null;
  }

  /**
   * Decide the final assignment number for a new transaction.
   * - If the user kept the auto-generated number, take it from the counter atomically
   *   (so two users can never get the same one).
   * - Otherwise (typed manually, random mode, date-only) just make sure it is unique.
   */
  async resolveAssignmentNumber(
    companyId: string | null | undefined,
    submitted: string,
    productIdRaw?: string,
  ): Promise<string> {
    if (!companyId) return submitted;
    const productId = sanitizeProductId(productIdRaw);

    const col = await this.col();
    const doc = await col.findOne({ companyId, productId });
    const cfg = doc?.assignmentNumber;

    if (cfg?.enabled && cfg.incremental && cfg.source !== "date") {
      const expected = await this.previewAssignmentNumber(companyId, productId).catch(() => null);
      if (expected && expected === submitted) {
        const today = riyadhToday();
        const cap = sequenceCapacity(cfg);
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          const n = await this.consumeCounter(companyId, productId, cfg, today);
          if (n === null) break;
          if (n >= cap) throw new BadRequestException({ message: "تم استنفاد أرقام التكليف المتاحة، زد الطول من القيم الافتراضية" });
          const v = generateAssignmentNumber(cfg, { counter: n, now: today });
          if (!(await this.numberExists(companyId, v))) return v;
        }
      }
    }

    if (await this.numberExists(companyId, submitted)) {
      throw new ConflictException({ message: "رقم التكليف مستخدم مسبقاً" });
    }
    return submitted;
  }
}
