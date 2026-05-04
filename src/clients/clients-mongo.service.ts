import { randomUUID } from "crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import {
  CLIENT_TYPES_COLLECTION,
  CLIENTS_COLLECTION,
  FORM_TEMPLATES_COLLECTION,
  type ClientDoc,
  type ClientTypeDoc,
  type FormFieldDoc,
  type FormTemplateDoc,
  type TemplateFieldType,
} from "@/server/models/clientsModule";

const ALLOWED_FIELD_TYPES: TemplateFieldType[] = [
  "text",
  "number",
  "date",
  "textarea",
  "email",
  "tel",
  "select",
  "file",
  "region",
  "city",
  "neighborhood",
];

function normalizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeFields(raw: unknown): FormFieldDoc[] {
  if (!Array.isArray(raw)) return [];
  const out: FormFieldDoc[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : "";
    const fieldType = rec.fieldType as TemplateFieldType;
    if (!label || !ALLOWED_FIELD_TYPES.includes(fieldType)) continue;
    const id = typeof rec.id === "string" && rec.id ? rec.id : randomUUID();
    if (fieldType === "select") {
      const options = normalizeOptions(rec.options);
      out.push({ id, label, fieldType: "select", options });
    } else if (fieldType === "file") {
      const multiple = rec.multiple === true;
      out.push({ id, label, fieldType: "file", multiple });
    } else {
      out.push({ id, label, fieldType });
    }
  }
  return out;
}

function assertSelectFieldsHaveOptions(fields: FormFieldDoc[]) {
  for (const f of fields) {
    if (f.fieldType === "select" && (!f.options || f.options.length === 0)) {
      throw new BadRequestException({
        message: `حقل القائمة «${f.label}» يتطلب خيارًا واحدًا على الأقل`,
      });
    }
  }
}

function normalizeClientBody(
  body: Record<string, unknown>,
): Omit<ClientDoc, "_id" | "createdAt" | "updatedAt"> | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return null;

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const active = Boolean(body.active);
  const typeId = typeof body.typeId === "string" ? body.typeId : "";
  if (!typeId) return null;

  const address = typeof body.address === "string" ? body.address.trim() : "";
  const clientAddress =
    typeof body.clientAddress === "string" ? body.clientAddress.trim() : "";
  const formTemplateId =
    typeof body.formTemplateId === "string" && body.formTemplateId
      ? body.formTemplateId
      : null;

  const templateFieldValues =
    body.templateFieldValues &&
    typeof body.templateFieldValues === "object" &&
    !Array.isArray(body.templateFieldValues)
      ? (body.templateFieldValues as Record<string, string>)
      : {};

  const bankName =
    typeof body.bankName === "string" ? body.bankName.trim() : "";
  const bankAccountAddress =
    typeof body.bankAccountAddress === "string"
      ? body.bankAccountAddress.trim()
      : "";
  const bankAccountNumber =
    typeof body.bankAccountNumber === "string"
      ? body.bankAccountNumber.trim()
      : "";

  return {
    name,
    phone,
    email,
    active,
    address,
    clientAddress,
    bankName,
    bankAccountAddress,
    bankAccountNumber,
    templateFieldValues,
    clientTypeId: typeId,
    formTemplateId,
  };
}

function toTypeJson(d: ClientTypeDoc) {
  return {
    id: d._id.toString(),
    name: d.name,
    createdAt: d.createdAt.toISOString(),
  };
}

function toTemplateJson(d: FormTemplateDoc) {
  return {
    id: d._id.toString(),
    name: d.name,
    fields: d.fields,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toClientJson(d: ClientDoc) {
  return {
    id: d._id.toString(),
    name: d.name,
    phone: d.phone,
    email: d.email,
    active: d.active,
    typeId: d.clientTypeId,
    address: d.address,
    clientAddress: d.clientAddress,
    formTemplateId: d.formTemplateId,
    templateFieldValues: d.templateFieldValues ?? {},
    bankName: d.bankName,
    bankAccountAddress: d.bankAccountAddress,
    bankAccountNumber: d.bankAccountNumber,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

@Injectable()
export class ClientsMongoService {
  async listClientTypes() {
    const db = await getMongoDb();
    const rows = await db
      .collection<ClientTypeDoc>(CLIENT_TYPES_COLLECTION)
      .find({})
      .sort({ createdAt: 1 })
      .toArray();
    return rows.map(toTypeJson);
  }

  async createClientType(name: string) {
    const n = name.trim();
    if (!n) throw new BadRequestException({ message: "اسم النوع مطلوب" });
    const db = await getMongoDb();
    const now = new Date();
    const doc: Omit<ClientTypeDoc, "_id"> = { name: n, createdAt: now };
    const { insertedId } = await db
      .collection(CLIENT_TYPES_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<ClientTypeDoc>(CLIENT_TYPES_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toTypeJson(row);
  }

  async updateClientType(id: string, name: string) {
    const n = name.trim();
    if (!n) throw new BadRequestException({ message: "اسم النوع مطلوب" });
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "النوع غير موجود" });
    const db = await getMongoDb();
    const _id = new ObjectId(id);
    const row = await db
      .collection<ClientTypeDoc>(CLIENT_TYPES_COLLECTION)
      .findOneAndUpdate(
        { _id },
        { $set: { name: n } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "النوع غير موجود" });
    return toTypeJson(row);
  }

  async deleteClientType(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "النوع غير موجود" });
    const db = await getMongoDb();
    const count = await db
      .collection(CLIENTS_COLLECTION)
      .countDocuments({ clientTypeId: id });
    if (count > 0) {
      throw new ConflictException({
        message: "لا يمكن حذف النوع لوجود عملاء مرتبطين به",
      });
    }
    const del = await db
      .collection(CLIENT_TYPES_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "النوع غير موجود" });
    return { ok: true };
  }

  async addClientFiles(
    clientId: string,
    fieldId: string,
    filenames: string[], // already-saved filenames on disk
  ): Promise<ReturnType<typeof toClientJson>> {
    if (!ObjectId.isValid(clientId))
      throw new NotFoundException({ message: "العميل غير موجود" });

    const db = await getMongoDb();
    const client = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOne({ _id: new ObjectId(clientId) });
    if (!client) throw new NotFoundException({ message: "العميل غير موجود" });

    const existing: string[] = Array.isArray(
      client.templateFieldValues?.[fieldId],
    )
      ? (client.templateFieldValues[fieldId] as unknown as string[])
      : [];

    const merged = [...existing, ...filenames];

    const row = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(clientId) },
        {
          $set: {
            [`templateFieldValues.${fieldId}`]: merged,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async removeClientFile(
    clientId: string,
    fieldId: string,
    filename: string,
  ): Promise<ReturnType<typeof toClientJson>> {
    if (!ObjectId.isValid(clientId))
      throw new NotFoundException({ message: "العميل غير موجود" });

    const db = await getMongoDb();
    const client = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOne({ _id: new ObjectId(clientId) });
    if (!client) throw new NotFoundException({ message: "العميل غير موجود" });

    const existing: string[] = Array.isArray(
      client.templateFieldValues?.[fieldId],
    )
      ? (client.templateFieldValues[fieldId] as unknown as string[])
      : [];

    const filtered = existing.filter((f) => f !== filename);

    const row = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(clientId) },
        {
          $set: {
            [`templateFieldValues.${fieldId}`]: filtered,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async listFormTemplates() {
    const db = await getMongoDb();
    const rows = await db
      .collection<FormTemplateDoc>(FORM_TEMPLATES_COLLECTION)
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();
    return rows.map(toTemplateJson);
  }

  async getFormTemplate(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "النموذج غير موجود" });
    const db = await getMongoDb();
    const row = await db
      .collection<FormTemplateDoc>(FORM_TEMPLATES_COLLECTION)
      .findOne({
        _id: new ObjectId(id),
      });
    if (!row) throw new NotFoundException({ message: "النموذج غير موجود" });
    return toTemplateJson(row);
  }

  async createFormTemplate(body: { name?: string; fields?: unknown }) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestException({ message: "اسم النموذج مطلوب" });
    const fields = normalizeFields(body.fields);
    if (fields.length === 0) {
      throw new BadRequestException({
        message: "أضف حقلًا واحدًا على الأقل للنموذج",
      });
    }
    assertSelectFieldsHaveOptions(fields);
    const db = await getMongoDb();
    const now = new Date();
    const doc: Omit<FormTemplateDoc, "_id"> = {
      name,
      fields,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db
      .collection(FORM_TEMPLATES_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<FormTemplateDoc>(FORM_TEMPLATES_COLLECTION)
      .findOne({
        _id: insertedId,
      });
    if (!row) throw new NotFoundException();
    return toTemplateJson(row);
  }

  async updateFormTemplate(
    id: string,
    body: { name?: string; fields?: unknown },
  ) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "النموذج غير موجود" });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestException({ message: "اسم النموذج مطلوب" });
    const fields = normalizeFields(body.fields);
    if (fields.length === 0) {
      throw new BadRequestException({
        message: "أضف حقلًا واحدًا على الأقل للنموذج",
      });
    }
    assertSelectFieldsHaveOptions(fields);
    const db = await getMongoDb();
    const _id = new ObjectId(id);
    const now = new Date();
    const row = await db
      .collection<FormTemplateDoc>(FORM_TEMPLATES_COLLECTION)
      .findOneAndUpdate(
        { _id },
        { $set: { name, fields, updatedAt: now } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "النموذج غير موجود" });
    return toTemplateJson(row);
  }

  async deleteFormTemplate(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "النموذج غير موجود" });
    const db = await getMongoDb();
    const _id = new ObjectId(id);
    const del = await db
      .collection(FORM_TEMPLATES_COLLECTION)
      .deleteOne({ _id });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "النموذج غير موجود" });
    await db
      .collection(CLIENTS_COLLECTION)
      .updateMany(
        { formTemplateId: id },
        { $set: { formTemplateId: null, templateFieldValues: {} } },
      );
    return { ok: true };
  }

  async listClients() {
    const db = await getMongoDb();
    const rows = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    return rows.map(toClientJson);
  }

  async getClient(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "العميل غير موجود" });
    const db = await getMongoDb();
    const row = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async createClient(body: Record<string, unknown>) {
    const normalized = normalizeClientBody(body);
    if (!normalized) {
      throw new BadRequestException({
        message: "اسم العميل ونوع العميل مطلوبان",
      });
    }
    const db = await getMongoDb();
    const typeOk = await db.collection(CLIENT_TYPES_COLLECTION).findOne({
      _id: new ObjectId(normalized.clientTypeId),
    });
    if (!typeOk)
      throw new BadRequestException({ message: "نوع العميل غير صالح" });
    if (normalized.formTemplateId) {
      const tpl = await db.collection(FORM_TEMPLATES_COLLECTION).findOne({
        _id: new ObjectId(normalized.formTemplateId),
      });
      if (!tpl) throw new BadRequestException({ message: "النموذج غير موجود" });
    }
    const now = new Date();
    const doc: Omit<ClientDoc, "_id"> = {
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db
      .collection(CLIENTS_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toClientJson(row);
  }

  async updateClient(id: string, body: Record<string, unknown>) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "العميل غير موجود" });
    const normalized = normalizeClientBody(body);
    if (!normalized) {
      throw new BadRequestException({
        message: "اسم العميل ونوع العميل مطلوبان",
      });
    }
    const db = await getMongoDb();
    const typeOk = await db.collection(CLIENT_TYPES_COLLECTION).findOne({
      _id: new ObjectId(normalized.clientTypeId),
    });
    if (!typeOk)
      throw new BadRequestException({ message: "نوع العميل غير صالح" });
    if (normalized.formTemplateId) {
      const tpl = await db.collection(FORM_TEMPLATES_COLLECTION).findOne({
        _id: new ObjectId(normalized.formTemplateId),
      });
      if (!tpl) throw new BadRequestException({ message: "النموذج غير موجود" });
    }
    const _id = new ObjectId(id);
    const now = new Date();
    const row = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOneAndUpdate(
        { _id },
        {
          $set: {
            ...normalized,
            updatedAt: now,
          },
        },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async deleteClient(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "العميل غير موجود" });
    const db = await getMongoDb();
    const del = await db
      .collection(CLIENTS_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "العميل غير موجود" });
    return { ok: true };
  }
}
