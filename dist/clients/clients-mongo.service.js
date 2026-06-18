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
const context_1 = require("../server/auth-tracking/context");
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
const CLIENT_PRODUCT_IDS = ["real-estate-valuation", "machine-valuation"];
const DEFAULT_CLIENT_PRODUCT_ID = "real-estate-valuation";
function normalizeClientProductId(raw) {
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (CLIENT_PRODUCT_IDS.includes(trimmed)) {
            return trimmed;
        }
    }
    return DEFAULT_CLIENT_PRODUCT_ID;
}
function queryValue(query, key) {
    const value = query?.[key];
    return Array.isArray(value) ? value[0] : value;
}
function companyObjectIdFilter(companyId) {
    return {
        $or: [
            { companyId },
            { companyId: companyId.toString() },
            { companyId: null },
            { companyId: { $exists: false } },
        ],
    };
}
function productFilter(productId) {
    if (productId === DEFAULT_CLIENT_PRODUCT_ID) {
        return {
            $or: [
                { productId },
                { productId: "" },
                { productId: null },
                { productId: { $exists: false } },
            ],
        };
    }
    return { productId };
}
function clientProductFilter(productId) {
    if (productId === DEFAULT_CLIENT_PRODUCT_ID) {
        return {
            $or: [
                { productIds: productId },
                { productIds: { $exists: false } },
                { productIds: { $size: 0 } },
            ],
        };
    }
    return { productIds: productId };
}
function coerceStringMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "string")
            out[key] = value;
        else if (Array.isArray(value))
            out[key] = JSON.stringify(value);
        else if (value != null)
            out[key] = String(value);
    }
    return out;
}
function normalizeProductIds(raw, fallback) {
    const values = Array.isArray(raw) ? raw : [];
    const out = values
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => CLIENT_PRODUCT_IDS.includes(item));
    return out.length ? Array.from(new Set(out)) : [fallback];
}
function normalizeSystemData(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const out = {};
    for (const [productId, value] of Object.entries(raw)) {
        if (!CLIENT_PRODUCT_IDS.includes(productId))
            continue;
        if (!value || typeof value !== "object" || Array.isArray(value))
            continue;
        const rec = value;
        out[productId] = {
            clientTypeId: typeof rec.clientTypeId === "string" ? rec.clientTypeId : "",
            formTemplateId: typeof rec.formTemplateId === "string" && rec.formTemplateId ? rec.formTemplateId : null,
            templateFieldValues: coerceStringMap(rec.templateFieldValues),
            clientAddress: typeof rec.clientAddress === "string" ? rec.clientAddress : "",
            bankName: typeof rec.bankName === "string" ? rec.bankName : "",
            bankAccountAddress: typeof rec.bankAccountAddress === "string" ? rec.bankAccountAddress : "",
            bankAccountNumber: typeof rec.bankAccountNumber === "string" ? rec.bankAccountNumber : "",
        };
    }
    return out;
}
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
    const active = body.active === undefined ? true : Boolean(body.active);
    const typeId = typeof body.typeId === "string" ? body.typeId : "";
    if (!typeId)
        return null;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const clientAddress = typeof body.clientAddress === "string" ? body.clientAddress.trim() : "";
    const formTemplateId = typeof body.formTemplateId === "string" && body.formTemplateId
        ? body.formTemplateId
        : null;
    const templateFieldValues = coerceStringMap(body.templateFieldValues);
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
function toClientJson(d, productId = DEFAULT_CLIENT_PRODUCT_ID) {
    const raw = d.toObject ? d.toObject() : d;
    const allSystemData = normalizeSystemData(raw.systemData);
    const system = allSystemData[productId];
    const productIds = normalizeProductIds(raw.productIds, DEFAULT_CLIENT_PRODUCT_ID);
    return {
        id: d._id.toString(),
        name: d.name,
        phone: d.phone,
        email: d.email,
        active: d.active,
        typeId: system?.clientTypeId || d.clientTypeId,
        address: d.address,
        clientAddress: system?.clientAddress ?? d.clientAddress,
        formTemplateId: system ? system.formTemplateId : d.formTemplateId,
        templateFieldValues: system?.templateFieldValues ?? d.templateFieldValues ?? {},
        bankName: system?.bankName ?? d.bankName,
        bankAccountAddress: system?.bankAccountAddress ?? d.bankAccountAddress,
        bankAccountNumber: system?.bankAccountNumber ?? d.bankAccountNumber,
        productIds,
        sharedClientId: typeof raw.sharedClientId === "string" ? raw.sharedClientId : "",
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
function systemDataFromClientFields(fields) {
    return {
        clientTypeId: fields.clientTypeId,
        formTemplateId: fields.formTemplateId,
        templateFieldValues: fields.templateFieldValues,
        clientAddress: fields.clientAddress,
        bankName: fields.bankName,
        bankAccountAddress: fields.bankAccountAddress,
        bankAccountNumber: fields.bankAccountNumber,
    };
}
function sharedClientPatch(fields) {
    return {
        name: fields.name,
        phone: fields.phone,
        email: fields.email,
        active: fields.active,
        address: fields.address,
    };
}
let ClientsMongoService = class ClientsMongoService {
    constructor(clientTypeModel, formTemplateModel, clientModel) {
        this.clientTypeModel = clientTypeModel;
        this.formTemplateModel = formTemplateModel;
        this.clientModel = clientModel;
    }
    async resolveScope(request, productInput) {
        const context = await (0, context_1.resolveRequestContext)(request);
        if (!context.user || context.isUserBlocked || context.user.isBlocked) {
            throw new common_1.ForbiddenException({ message: "Authentication required" });
        }
        if (!context.company) {
            throw new common_1.ForbiddenException({ message: "Company context required" });
        }
        const companyId = new mongoose_2.Types.ObjectId(context.company._id.toString());
        const productId = normalizeClientProductId(productInput);
        if (context.user.role !== "super_admin" &&
            context.companyMembership?.role !== "company_admin") {
            const allowed = context.companyMembership?.productIds?.length
                ? context.companyMembership.productIds
                : context.company.valueTechProductIds;
            if (!allowed?.includes(productId)) {
                throw new common_1.ForbiddenException({ message: "No access to this product" });
            }
        }
        return { companyId, productId };
    }
    scopedCompanyFilter(scope) {
        return companyObjectIdFilter(scope.companyId);
    }
    scopedProductFilter(scope) {
        return productFilter(scope.productId);
    }
    scopedClientFilter(scope, includeAllProducts = false) {
        return includeAllProducts
            ? this.scopedCompanyFilter(scope)
            : {
                $and: [this.scopedCompanyFilter(scope), clientProductFilter(scope.productId)],
            };
    }
    async assertClientFormRefs(scope, normalized) {
        if (!mongoose_2.Types.ObjectId.isValid(normalized.clientTypeId)) {
            throw new common_1.BadRequestException({ message: "Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù…ÙŠÙ„ ØºÙŠØ± ØµØ§Ù„Ø­" });
        }
        const typeOk = await this.clientTypeModel
            .findOne({
            _id: new mongoose_2.Types.ObjectId(normalized.clientTypeId),
            $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)],
        })
            .exec();
        if (!typeOk) {
            throw new common_1.BadRequestException({ message: "Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù…ÙŠÙ„ ØºÙŠØ± ØµØ§Ù„Ø­" });
        }
        if (normalized.formTemplateId) {
            if (!mongoose_2.Types.ObjectId.isValid(normalized.formTemplateId)) {
                throw new common_1.BadRequestException({ message: "Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
            }
            const tpl = await this.formTemplateModel
                .findOne({
                _id: new mongoose_2.Types.ObjectId(normalized.formTemplateId),
                $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)],
            })
                .exec();
            if (!tpl)
                throw new common_1.BadRequestException({ message: "Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
        }
    }
    async listClientTypes(request, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        const rows = await this.clientTypeModel
            .find({ $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] })
            .sort({ createdAt: 1 })
            .exec();
        return rows.map(toTypeJson);
    }
    async createClientType(request, body) {
        const scope = await this.resolveScope(request, body.productId);
        const name = body.name ?? "";
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        const created = await this.clientTypeModel.create({
            name: n,
            companyId: scope.companyId,
            productId: scope.productId,
        });
        return toTypeJson(created);
    }
    async updateClientType(request, id, body) {
        const scope = await this.resolveScope(request, body.productId);
        const name = body.name ?? "";
        const n = name.trim();
        if (!n)
            throw new common_1.BadRequestException({ message: "اسم النوع مطلوب" });
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const row = await this.clientTypeModel
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] }, { $set: { name: n, companyId: scope.companyId, productId: scope.productId } }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        return toTypeJson(row);
    }
    async deleteClientType(request, id, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النوع غير موجود" });
        const count = await this.clientModel
            .countDocuments({
            $and: [
                this.scopedClientFilter(scope, true),
                {
                    $or: [
                        { clientTypeId: id },
                        { [`systemData.${scope.productId}.clientTypeId`]: id },
                    ],
                },
            ],
        })
            .exec();
        if (count > 0) {
            throw new common_1.ConflictException({
                message: "لا يمكن حذف النوع لوجود عملاء مرتبطين به",
            });
        }
        const del = await this.clientTypeModel
            .deleteOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] })
            .exec();
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
    async listFormTemplates(request, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        const rows = await this.formTemplateModel
            .find({ $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] })
            .sort({ updatedAt: -1 })
            .exec();
        return rows.map(toTemplateJson);
    }
    async getFormTemplate(request, id, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const row = await this.formTemplateModel
            .findOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        return toTemplateJson(row);
    }
    async createFormTemplate(request, body) {
        const scope = await this.resolveScope(request, body.productId);
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
        const created = await this.formTemplateModel.create({
            name,
            fields,
            companyId: scope.companyId,
            productId: scope.productId,
        });
        return toTemplateJson(created);
    }
    async updateFormTemplate(request, id, body) {
        const scope = await this.resolveScope(request, body.productId);
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
            .findOneAndUpdate({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] }, { $set: { name, fields, companyId: scope.companyId, productId: scope.productId, updatedAt: now } }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        return toTemplateJson(row);
    }
    async deleteFormTemplate(request, id, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        const del = await this.formTemplateModel
            .deleteOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedCompanyFilter(scope), this.scopedProductFilter(scope)] })
            .exec();
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "النموذج غير موجود" });
        await this.clientModel
            .updateMany({
            $and: [
                this.scopedClientFilter(scope, true),
                {
                    $or: [
                        { formTemplateId: id },
                        { [`systemData.${scope.productId}.formTemplateId`]: id },
                    ],
                },
            ],
        }, {
            $set: {
                formTemplateId: null,
                templateFieldValues: {},
                [`systemData.${scope.productId}.formTemplateId`]: null,
                [`systemData.${scope.productId}.templateFieldValues`]: {},
            },
        })
            .exec();
        return { ok: true };
    }
    async listClients(request, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        const includeAllProducts = queryValue(query, "scope") === "all";
        const rawQ = queryValue(query, "q");
        const q = typeof rawQ === "string" ? rawQ.trim() : "";
        const clauses = [
            this.scopedClientFilter(scope, includeAllProducts),
        ];
        if (q) {
            const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            clauses.push({
                $or: [{ name: rx }, { phone: rx }, { email: rx }, { clientAddress: rx }],
            });
        }
        const rows = await this.clientModel
            .find({ $and: clauses })
            .sort({ createdAt: -1 })
            .limit(includeAllProducts ? 100 : 500)
            .exec();
        return rows.map((row) => toClientJson(row, scope.productId));
    }
    async getClient(request, id, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const row = await this.clientModel
            .findOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedClientFilter(scope, true)] })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row, scope.productId);
    }
    async createClient(request, body) {
        const scope = await this.resolveScope(request, body.productId);
        const normalized = normalizeClientBody(body);
        if (!normalized) {
            throw new common_1.BadRequestException({
                message: "اسم العميل ونوع العميل مطلوبان",
            });
        }
        await this.assertClientFormRefs(scope, normalized);
        const typeOk = true;
        if (false && !typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await this.formTemplateModel
                .findById(normalized.formTemplateId)
                .exec();
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const systemData = systemDataFromClientFields(normalized);
        const linkFromClientId = typeof body.linkFromClientId === "string" && mongoose_2.Types.ObjectId.isValid(body.linkFromClientId)
            ? body.linkFromClientId
            : "";
        if (linkFromClientId) {
            const row = await this.clientModel
                .findOne({ _id: new mongoose_2.Types.ObjectId(linkFromClientId), $and: [this.scopedClientFilter(scope, true)] })
                .exec();
            if (!row)
                throw new common_1.NotFoundException({ message: "Ø§Ù„Ø¹Ù…ÙŠÙ„ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
            const raw = row.toObject();
            const productIds = normalizeProductIds(raw.productIds, DEFAULT_CLIENT_PRODUCT_ID);
            const nextProductIds = Array.from(new Set([...productIds, scope.productId]));
            const updated = await this.clientModel
                .findOneAndUpdate({ _id: row._id }, {
                $set: {
                    ...sharedClientPatch(normalized),
                    ...systemData,
                    companyId: scope.companyId,
                    productIds: nextProductIds,
                    sharedClientId: typeof raw.sharedClientId === "string" && raw.sharedClientId ? raw.sharedClientId : (0, crypto_1.randomUUID)(),
                    [`systemData.${scope.productId}`]: systemData,
                    updatedAt: new Date(),
                },
            }, { new: true })
                .exec();
            if (!updated)
                throw new common_1.NotFoundException({ message: "Ø§Ù„Ø¹Ù…ÙŠÙ„ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯" });
            return toClientJson(updated, scope.productId);
        }
        const created = await this.clientModel.create({
            ...normalized,
            companyId: scope.companyId,
            productIds: [scope.productId],
            sharedClientId: (0, crypto_1.randomUUID)(),
            systemData: {
                [scope.productId]: systemData,
            },
        });
        return toClientJson(created, scope.productId);
    }
    async updateClient(request, id, body) {
        const scope = await this.resolveScope(request, body.productId);
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const normalized = normalizeClientBody(body);
        if (!normalized) {
            throw new common_1.BadRequestException({
                message: "اسم العميل ونوع العميل مطلوبان",
            });
        }
        await this.assertClientFormRefs(scope, normalized);
        const typeOk = await this.clientTypeModel
            .findById(normalized.clientTypeId)
            .exec();
        if (!typeOk)
            throw new common_1.BadRequestException({ message: "نوع العميل غير صالح" });
        if (normalized.formTemplateId) {
            const tpl = await this.formTemplateModel
                .findById(normalized.formTemplateId)
                .exec();
            if (!tpl)
                throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
        }
        const existing = await this.clientModel
            .findOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedClientFilter(scope, true)] })
            .exec();
        if (!existing)
            throw new common_1.NotFoundException({ message: "Client not found" });
        const raw = existing.toObject();
        const productIds = normalizeProductIds(raw.productIds, DEFAULT_CLIENT_PRODUCT_ID);
        const nextProductIds = Array.from(new Set([...productIds, scope.productId]));
        const systemData = systemDataFromClientFields(normalized);
        const now = new Date();
        const row = await this.clientModel
            .findOneAndUpdate({ _id: existing._id }, {
            $set: {
                ...sharedClientPatch(normalized),
                ...systemData,
                companyId: scope.companyId,
                productIds: nextProductIds,
                sharedClientId: typeof raw.sharedClientId === "string" && raw.sharedClientId
                    ? raw.sharedClientId
                    : (0, crypto_1.randomUUID)(),
                [`systemData.${scope.productId}`]: systemData,
                updatedAt: now,
            },
        }, { new: true })
            .exec();
        if (!row)
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        return toClientJson(row, scope.productId);
    }
    async deleteClient(request, id, query = {}) {
        const scope = await this.resolveScope(request, queryValue(query, "productId"));
        if (!mongoose_2.Types.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "العميل غير موجود" });
        const existing = await this.clientModel
            .findOne({ _id: new mongoose_2.Types.ObjectId(id), $and: [this.scopedClientFilter(scope, true)] })
            .exec();
        if (!existing)
            throw new common_1.NotFoundException({ message: "Client not found" });
        const raw = existing.toObject();
        const productIds = normalizeProductIds(raw.productIds, DEFAULT_CLIENT_PRODUCT_ID);
        const nextProductIds = productIds.filter((item) => item !== scope.productId);
        if (productIds.length > 1 && nextProductIds.length > 0) {
            await this.clientModel
                .updateOne({ _id: existing._id }, {
                $set: { productIds: nextProductIds, updatedAt: new Date() },
                $unset: { [`systemData.${scope.productId}`]: "" },
            })
                .exec();
            return { ok: true, productUnlinked: true };
        }
        const del = await this.clientModel
            .deleteOne({ _id: existing._id })
            .exec();
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
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model])
], ClientsMongoService);
