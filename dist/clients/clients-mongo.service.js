"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientsMongoService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const clientsModule_1 = require("../server/models/clientsModule");
const ALLOWED_FIELD_TYPES = [
    "text",
    "number",
    "date",
    "textarea",
    "email",
    "tel",
    "select",
    "file",
];
function normalizeOptions(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const x of raw) {
        if (typeof x !== "string")
            continue;
        const t = x.trim();
        if (!t || seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}
function normalizeFields(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== "object")
            continue;
        const rec = item;
        const label = typeof rec.label === "string" ? rec.label.trim() : "";
        const fieldType = rec.fieldType;
        if (!label || !ALLOWED_FIELD_TYPES.includes(fieldType))
            continue;
        const id = typeof rec.id === "string" && rec.id ? rec.id : (0, crypto_1.randomUUID)();
        if (fieldType === "select") {
            const options = normalizeOptions(rec.options);
            out.push({ id, label, fieldType: "select", options });
        }
        else if (fieldType === "file") {
            const multiple = rec.multiple === true;
            out.push({ id, label, fieldType: "file", multiple });
        }
        else {
            out.push({ id, label, fieldType });
        }
    }
    return out;
}
function assertSelectFieldsHaveOptions(fields) {
    for (const f of fields) {
        if (f.fieldType === "select" && (!f.options || f.options.length === 0)) {
            throw new common_1.BadRequestException({
                message: `حقل القائمة «${f.label}» يتطلب خيارًا واحدًا على الأقل`,
            });
        }
    }
}
function normalizeClientBody(body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name)
        return null;
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const active = Boolean(body.active);
    const typeId = typeof body.typeId === "string" ? body.typeId : "";
    if (!typeId)
        return null;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const clientAddress = typeof body.clientAddress === "string" ? body.clientAddress.trim() : "";
    const formTemplateId = typeof body.formTemplateId === "string" && body.formTemplateId
        ? body.formTemplateId
        : null;
    const templateFieldValues = body.templateFieldValues &&
        typeof body.templateFieldValues === "object" &&
        !Array.isArray(body.templateFieldValues)
        ? body.templateFieldValues
        : {};
    const bankName = typeof body.bankName === "string" ? body.bankName.trim() : "";
    const bankAccountAddress = typeof body.bankAccountAddress === "string"
        ? body.bankAccountAddress.trim()
        : "";
    const bankAccountNumber = typeof body.bankAccountNumber === "string"
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
function toTypeJson(d) {
    return {
        id: d._id.toString(),
        name: d.name,
        createdAt: d.createdAt.toISOString(),
    };
}
function toTemplateJson(d) {
    return {
        id: d._id.toString(),
        name: d.name,
        fields: d.fields,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
function toClientJson(d) {
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
let ClientsMongoService = class ClientsMongoService {
    async listClientTypes() {
        const db = await (0, mongodb_2.getMongoDb)();
        const rows = await db
            .collection(clientsModule_1.CLIENT_TYPES_COLLECTION)
            .find({})
            .sort({ createdAt: 1 })
            .toArray();
        return rows.map(toTypeJson);
    }
    async createClientType(name) {
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const doc = { name: n, createdAt: now };
        const { insertedId } = await db
            .collection(clientsModule_1.CLIENT_TYPES_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(clientsModule_1.CLIENT_TYPES_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toTypeJson(row);
    }
    async updateClientType(id, name) {
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = new mongodb_1.ObjectId(id);
        const row = await db
            .collection(clientsModule_1.CLIENT_TYPES_COLLECTION)
            .findOneAndUpdate({ _id }, { $set: { name: n } }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        return toTypeJson(row);
    }
    async deleteClientType(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const count = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .countDocuments({ clientTypeId: id });
        if (count > 0) {
            throw new common_1.ConflictException({
                message: "لا يمكن حذف النوع لوجود عملاء مرتبطين به",
            });
        }
        const del = await db
            .collection(clientsModule_1.CLIENT_TYPES_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        return { ok: true };
    }
    async addClientFiles(clientId, fieldId, filenames) {
        if (!mongodb_1.ObjectId.isValid(clientId))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const client = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(clientId) });
        if (!client)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const existing = Array.isArray(client.templateFieldValues?.[fieldId])
            ? client.templateFieldValues[fieldId]
            : [];
        const merged = [...existing, ...filenames];
        const row = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(clientId) }, {
            $set: {
                [`templateFieldValues.${fieldId}`]: merged,
                updatedAt: new Date(),
            },
        }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async removeClientFile(clientId, fieldId, filename) {
        if (!mongodb_1.ObjectId.isValid(clientId))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const client = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(clientId) });
        if (!client)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const existing = Array.isArray(client.templateFieldValues?.[fieldId])
            ? client.templateFieldValues[fieldId]
            : [];
        const filtered = existing.filter((f) => f !== filename);
        const row = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(clientId) }, {
            $set: {
                [`templateFieldValues.${fieldId}`]: filtered,
                updatedAt: new Date(),
            },
        }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async listFormTemplates() {
        const db = await (0, mongodb_2.getMongoDb)();
        const rows = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .find({})
            .sort({ updatedAt: -1 })
            .toArray();
        return rows.map(toTemplateJson);
    }
    async getFormTemplate(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .findOne({
            _id: new mongodb_1.ObjectId(id),
        });
        if (!row)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        return toTemplateJson(row);
    }
    async createFormTemplate(body) {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name)
            throw new common_1.BadRequestException({ message: "اسم النموذج مطلوب" });
        const fields = normalizeFields(body.fields);
        if (fields.length === 0) {
            throw new common_1.BadRequestException({
                message: "أضف حقلًا واحدًا على الأقل للنموذج",
            });
        }
        assertSelectFieldsHaveOptions(fields);
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const doc = {
            name,
            fields,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .findOne({
            _id: insertedId,
        });
        if (!row)
            throw new common_1.NotFoundException();
        return toTemplateJson(row);
    }
    async updateFormTemplate(id, body) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name)
            throw new common_1.BadRequestException({ message: "اسم النموذج مطلوب" });
        const fields = normalizeFields(body.fields);
        if (fields.length === 0) {
            throw new common_1.BadRequestException({
                message: "أضف حقلًا واحدًا على الأقل للنموذج",
            });
        }
        assertSelectFieldsHaveOptions(fields);
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = new mongodb_1.ObjectId(id);
        const now = new Date();
        const row = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .findOneAndUpdate({ _id }, { $set: { name, fields, updatedAt: now } }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        return toTemplateJson(row);
    }
    async deleteFormTemplate(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = new mongodb_1.ObjectId(id);
        const del = await db
            .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
            .deleteOne({ _id });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .updateMany({ formTemplateId: id }, { $set: { formTemplateId: null, templateFieldValues: {} } });
        return { ok: true };
    }
    async listClients() {
        const db = await (0, mongodb_2.getMongoDb)();
        const rows = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        return rows.map(toClientJson);
    }
    async getClient(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async createClient(body) {
        const normalized = normalizeClientBody(body);
        if (!normalized) {
            throw new common_1.BadRequestException({
                message: "اسم العميل ونوع العميل مطلوبان",
            });
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const typeOk = await db.collection(clientsModule_1.CLIENT_TYPES_COLLECTION).findOne({
            _id: new mongodb_1.ObjectId(normalized.clientTypeId),
        });
        if (!typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await db.collection(clientsModule_1.FORM_TEMPLATES_COLLECTION).findOne({
                _id: new mongodb_1.ObjectId(normalized.formTemplateId),
            });
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const now = new Date();
        const doc = {
            ...normalized,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toClientJson(row);
    }
    async updateClient(id, body) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const normalized = normalizeClientBody(body);
        if (!normalized) {
            throw new common_1.BadRequestException({
                message: "اسم العميل ونوع العميل مطلوبان",
            });
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const typeOk = await db.collection(clientsModule_1.CLIENT_TYPES_COLLECTION).findOne({
            _id: new mongodb_1.ObjectId(normalized.clientTypeId),
        });
        if (!typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await db.collection(clientsModule_1.FORM_TEMPLATES_COLLECTION).findOne({
                _id: new mongodb_1.ObjectId(normalized.formTemplateId),
            });
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const _id = new mongodb_1.ObjectId(id);
        const now = new Date();
        const row = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOneAndUpdate({ _id }, {
            $set: {
                ...normalized,
                updatedAt: now,
            },
        }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async deleteClient(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return { ok: true };
    }
};
exports.ClientsMongoService = ClientsMongoService;
exports.ClientsMongoService = ClientsMongoService = __decorate([
    (0, common_1.Injectable)()
], ClientsMongoService);
