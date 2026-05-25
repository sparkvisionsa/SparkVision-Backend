"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mvProjectSharesCompany = mvProjectSharesCompany;
const mongodb_1 = require("mongodb");
const object_id_util_1 = require("../common/object-id.util");
function mvProjectSharesCompany(project, companyOid) {
    const c = project.companyId;
    if (c === undefined || c === null)
        return false;
    if (c === "")
        return false;
    if (c instanceof mongodb_1.ObjectId)
        return c.equals(companyOid);
    const s = String(c).trim();
    if (!s)
        return false;
    const parsed = (0, object_id_util_1.tryParseObjectId)(s);
    if (parsed && parsed.equals(companyOid))
        return true;
    return s === companyOid.toString();
}
