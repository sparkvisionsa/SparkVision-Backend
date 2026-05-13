import { randomUUID } from "crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  type ClientUpsertFields,
  type FormFieldDoc,
  type TemplateFieldType,
} from "@/server/models/clientsModule";
import { Client, type ClientDocument } from "./schemas/client.schema";
import { ClientType, type ClientTypeDocument } from "./schemas/client-type.schema";
import { FormTemplate, type FormTemplateDocument } from "./schemas/form-template.schema";

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

function normalizeClientBody(body: Record<string, unknown>): ClientUpsertFields | null {
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

function toTypeJson(d: ClientTypeDocument) {
  return {
    id: d._id.toString(),
    name: d.name,
    createdAt: d.createdAt.toISOString(),
  };
}

function toTemplateJson(d: FormTemplateDocument) {
  return {
    id: d._id.toString(),
    name: d.name,
    fields: d.fields,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toClientJson(d: ClientDocument) {
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
  constructor(
    @InjectModel(ClientType.name) private readonly clientTypeModel: Model<ClientTypeDocument>,
    @InjectModel(FormTemplate.name) private readonly formTemplateModel: Model<FormTemplateDocument>,
    @InjectModel(Client.name) private readonly clientModel: Model<ClientDocument>,
  ) {}

  async listClientTypes() {
    const rows = await this.clientTypeModel.find({}).sort({ createdAt: 1 }).exec();
    return rows.map(toTypeJson);
  }

  async createClientType(name: string) {
    const n = name.trim();
    if (!n) throw new BadRequestException({ message: "اسم النوع مطلوب" });
    const created = await this.clientTypeModel.create({ name: n });
    return toTypeJson(created);
  }

  async updateClientType(id: string, name: string) {
    const n = name.trim();
    if (!n) throw new BadRequestException({ message: "اسم النوع مطلوب" });
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "النوع غير موجود" });
    const row = await this.clientTypeModel
      .findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: { name: n } }, { new: true })
      .exec();
    if (!row) throw new NotFoundException({ message: "النوع غير موجود" });
    return toTypeJson(row);
  }

  async deleteClientType(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "النوع غير موجود" });
    const count = await this.clientModel.countDocuments({ clientTypeId: id }).exec();
    if (count > 0) {
      throw new ConflictException({
        message: "لا يمكن حذف النوع لوجود عملاء مرتبطين به",
      });
    }
    const del = await this.clientTypeModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    if (del.deletedCount === 0) throw new NotFoundException({ message: "النوع غير موجود" });
    return { ok: true };
  }

  async addClientFiles(
    clientId: string,
    fieldId: string,
    filenames: string[],
  ): Promise<ReturnType<typeof toClientJson>> {
    if (!Types.ObjectId.isValid(clientId))
      throw new NotFoundException({ message: "العميل غير موجود" });

    const client = await this.clientModel.findById(clientId).exec();
    if (!client) throw new NotFoundException({ message: "العميل غير موجود" });

    const existing: string[] = Array.isArray(client.templateFieldValues?.[fieldId])
      ? (client.templateFieldValues[fieldId] as unknown as string[])
      : [];

    const merged = [...existing, ...filenames];

    const row = await this.clientModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(clientId) },
        {
          $set: {
            [`templateFieldValues.${fieldId}`]: merged,
            updatedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async removeClientFile(
    clientId: string,
    fieldId: string,
    filename: string,
  ): Promise<ReturnType<typeof toClientJson>> {
    if (!Types.ObjectId.isValid(clientId))
      throw new NotFoundException({ message: "العميل غير موجود" });

    const client = await this.clientModel.findById(clientId).exec();
    if (!client) throw new NotFoundException({ message: "العميل غير موجود" });

    const existing: string[] = Array.isArray(client.templateFieldValues?.[fieldId])
      ? (client.templateFieldValues[fieldId] as unknown as string[])
      : [];

    const filtered = existing.filter((f) => f !== filename);

    const row = await this.clientModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(clientId) },
        {
          $set: {
            [`templateFieldValues.${fieldId}`]: filtered,
            updatedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async listFormTemplates() {
    const rows = await this.formTemplateModel.find({}).sort({ updatedAt: -1 }).exec();
    return rows.map(toTemplateJson);
  }

  async getFormTemplate(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "النموذج غير موجود" });
    const row = await this.formTemplateModel.findById(id).exec();
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
    const created = await this.formTemplateModel.create({ name, fields });
    return toTemplateJson(created);
  }

  async updateFormTemplate(id: string, body: { name?: string; fields?: unknown }) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "النموذج غير موجود" });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestException({ message: "اسم النموذج مطلوب" });
    const fields = normalizeFields(body.fields);
    if (fields.length === 0) {
      throw new BadRequestException({
        message: "أضف حقلًا واحدًا على الأقل للنموذج",
      });
    }
    assertSelectFieldsHaveOptions(fields);
    const now = new Date();
    const row = await this.formTemplateModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { $set: { name, fields, updatedAt: now } },
        { new: true },
      )
      .exec();
    if (!row) throw new NotFoundException({ message: "النموذج غير موجود" });
    return toTemplateJson(row);
  }

  async deleteFormTemplate(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "النموذج غير موجود" });
    const del = await this.formTemplateModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    if (del.deletedCount === 0) throw new NotFoundException({ message: "النموذج غير موجود" });
    await this.clientModel
      .updateMany({ formTemplateId: id }, { $set: { formTemplateId: null, templateFieldValues: {} } })
      .exec();
    return { ok: true };
  }

  async listClients() {
    const rows = await this.clientModel.find({}).sort({ createdAt: -1 }).exec();
    return rows.map(toClientJson);
  }

  async getClient(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "العميل غير موجود" });
    const row = await this.clientModel.findById(id).exec();
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
    const typeOk = await this.clientTypeModel.findById(normalized.clientTypeId).exec();
    if (!typeOk) throw new BadRequestException({ message: "نوع العميل غير صالح" });
    if (normalized.formTemplateId) {
      const tpl = await this.formTemplateModel.findById(normalized.formTemplateId).exec();
      if (!tpl) throw new BadRequestException({ message: "النموذج غير موجود" });
    }
    const created = await this.clientModel.create(normalized);
    return toClientJson(created);
  }

  async updateClient(id: string, body: Record<string, unknown>) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "العميل غير موجود" });
    const normalized = normalizeClientBody(body);
    if (!normalized) {
      throw new BadRequestException({
        message: "اسم العميل ونوع العميل مطلوبان",
      });
    }
    const typeOk = await this.clientTypeModel.findById(normalized.clientTypeId).exec();
    if (!typeOk) throw new BadRequestException({ message: "نوع العميل غير صالح" });
    if (normalized.formTemplateId) {
      const tpl = await this.formTemplateModel.findById(normalized.formTemplateId).exec();
      if (!tpl) throw new BadRequestException({ message: "النموذج غير موجود" });
    }
    const now = new Date();
    const row = await this.clientModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { $set: { ...normalized, updatedAt: now } },
        { new: true },
      )
      .exec();
    if (!row) throw new NotFoundException({ message: "العميل غير موجود" });
    return toClientJson(row);
  }

  async deleteClient(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException({ message: "العميل غير موجود" });
    const del = await this.clientModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    if (del.deletedCount === 0) throw new NotFoundException({ message: "العميل غير موجود" });
    return { ok: true };
  }
}