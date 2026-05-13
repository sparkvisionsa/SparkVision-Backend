"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientsMongoService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const client_schema_1 = require("./schemas/client.schema");
const client_type_schema_1 = require("./schemas/client-type.schema");
const form_template_schema_1 = require("./schemas/form-template.schema");
const ALLOWED_FIELD_TYPES = [
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
    constructor(clientTypeModel, formTemplateModel, clientModel) {
        this.clientTypeModel = clientTypeModel;
        this.formTemplateModel = formTemplateModel;
        this.clientModel = clientModel;
    }
    async listClientTypes() {
        const rows = await this.clientTypeModel.find({}).sort({ createdAt: 1 }).exec();
        return rows.map(toTypeJson);
    }
    async createClientType(name) {
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        const created = await this.clientTypeModel.create({ name: n });
        return toTypeJson(created);
    }
    async updateClientType(id, name) {
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const row = await this.clientTypeModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(id) }, { $set: { name: n } }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        return toTypeJson(row);
    }
    async deleteClientType(id) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const count = await this.clientModel.countDocuments({ clientTypeId: id }).exec();
        if (count > 0) {
            throw new common_1.ConflictException({
                message: "لا يمكن حذف النوع لوجود عملاء مرتبطين به",
            });
        }
        const del = await this.clientTypeModel.deleteOne({ _id: new mongoose_2.Types.ObjectId(id) }).exec();
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        return { ok: true };
    }
    async addClientFiles(clientId, fieldId, filenames) {
        if (!mongoose_2.Types.ObjectId.isValid(clientId))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const client = await this.clientModel.findById(clientId).exec();
        if (!client)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const existing = Array.isArray(client.templateFieldValues?.[fieldId])
            ? client.templateFieldValues[fieldId]
            : [];
        const merged = [...existing, ...filenames];
        const row = await this.clientModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(clientId) }, {
            $set: {
                [`templateFieldValues.${fieldId}`]: merged,
                updatedAt: new Date(),
            },
        }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async removeClientFile(clientId, fieldId, filename) {
        if (!mongoose_2.Types.ObjectId.isValid(clientId))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const client = await this.clientModel.findById(clientId).exec();
        if (!client)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const existing = Array.isArray(client.templateFieldValues?.[fieldId])
            ? client.templateFieldValues[fieldId]
            : [];
        const filtered = existing.filter((f) => f !== filename);
        const row = await this.clientModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(clientId) }, {
            $set: {
                [`templateFieldValues.${fieldId}`]: filtered,
                updatedAt: new Date(),
            },
        }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async listFormTemplates() {
        const rows = await this.formTemplateModel.find({}).sort({ updatedAt: -1 }).exec();
        return rows.map(toTemplateJson);
    }
    async getFormTemplate(id) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const row = await this.formTemplateModel.findById(id).exec();
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
        const created = await this.formTemplateModel.create({ name, fields });
        return toTemplateJson(created);
    }
    async updateFormTemplate(id, body) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
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
        const now = new Date();
        const row = await this.formTemplateModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(id) }, { $set: { name, fields, updatedAt: now } }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        return toTemplateJson(row);
    }
    async deleteFormTemplate(id) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const del = await this.formTemplateModel.deleteOne({ _id: new mongoose_2.Types.ObjectId(id) }).exec();
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        await this.clientModel
            .updateMany({ formTemplateId: id }, { $set: { formTemplateId: null, templateFieldValues: {} } })
            .exec();
        return { ok: true };
    }
    async listClients() {
        const rows = await this.clientModel.find({}).sort({ createdAt: -1 }).exec();
        return rows.map(toClientJson);
    }
    async getClient(id) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const row = await this.clientModel.findById(id).exec();
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
        const typeOk = await this.clientTypeModel.findById(normalized.clientTypeId).exec();
        if (!typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await this.formTemplateModel.findById(normalized.formTemplateId).exec();
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const created = await this.clientModel.create(normalized);
        return toClientJson(created);
    }
    async updateClient(id, body) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const normalized = normalizeClientBody(body);
        if (!normalized) {
            throw new common_1.BadRequestException({
                message: "اسم العميل ونوع العميل مطلوبان",
            });
        }
        const typeOk = await this.clientTypeModel.findById(normalized.clientTypeId).exec();
        if (!typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await this.formTemplateModel.findById(normalized.formTemplateId).exec();
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const now = new Date();
        const row = await this.clientModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(id) }, { $set: { ...normalized, updatedAt: now } }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row);
    }
    async deleteClient(id) {
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const del = await this.clientModel.deleteOne({ _id: new mongoose_2.Types.ObjectId(id) }).exec();
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return { ok: true };
    }
};
exports.ClientsMongoService = ClientsMongoService;
exports.ClientsMongoService = ClientsMongoService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(client_type_schema_1.ClientType.name)),
    __param(1, (0, mongoose_1.InjectModel)(form_template_schema_1.FormTemplate.name)),
    __param(2, (0, mongoose_1.InjectModel)(client_schema_1.Client.name)),
    __metadata("design-paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model])
], ClientsMongoService);