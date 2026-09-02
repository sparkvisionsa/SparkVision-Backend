import { Long, type Db, type UpdateFilter } from "mongodb";

const ASSET_SEQUENCE_COLLECTION = "asset_sequences";
const VAL_TECH_ID_SEQUENCE_KEY = "val_tech_id";

type AssetSequenceDoc = {
  _id: string;
  value: Long | number | string;
};

function toLong(value: unknown): Long {
  if (Long.isLong(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Long.fromNumber(Math.trunc(value), true);
  }
  if (typeof value === "bigint") {
    return Long.fromBigInt(value, true);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Long.fromString(value.trim(), true);
  }
  if (value && typeof value === "object") {
    const rec = value as { low?: unknown; high?: unknown; unsigned?: unknown };
    if (typeof rec.low === "number" && typeof rec.high === "number") {
      return Long.fromBits(rec.low, rec.high, rec.unsigned !== false);
    }
  }
  return Long.ZERO;
}

/**
 * يحجز نطاقاً متصلاً من المعرفات الرقمية بشكل ذري على مستوى قاعدة البيانات.
 *
 * يستعمل BSON Int64 بدلاً من JavaScript number؛ إذ إن `number` يفقد الدقة بعد
 * 2^53-1، بينما Int64 يدعم حتى 9,223,372,036,854,775,807.
 * السائق قد يعيد العداد كـ number أو Long حسب نوع BSON المخزَّن.
 */
export async function reserveValTechIds(db: Db, count: number): Promise<Long[]> {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Asset sequence reservation count must be a positive safe integer.");
  }

  const increment = Long.fromNumber(count, true);
  const counter = await db.collection<AssetSequenceDoc>(ASSET_SEQUENCE_COLLECTION).findOneAndUpdate(
    { _id: VAL_TECH_ID_SEQUENCE_KEY },
    { $inc: { value: increment } } as unknown as UpdateFilter<AssetSequenceDoc>,
    { upsert: true, returnDocument: "after" },
  );
  if (!counter) {
    throw new Error("Unable to reserve asset sequence values.");
  }

  const after = toLong((counter as { value?: unknown }).value);
  const first = after.subtract(increment).add(Long.ONE);
  return Array.from({ length: count }, (_, index) => first.add(Long.fromNumber(index, true)));
}
