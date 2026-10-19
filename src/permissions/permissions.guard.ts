import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { getMongoDb } from "@/server/mongodb";
import { resolveRequestContext } from "@/server/auth-tracking/context";
import type { ValueTechProductId } from "@/server/auth-tracking/types";
import { effectivePermissionGrants } from "./permissions.service";

type Requirement = { productId: ValueTechProductId; grant: string };

function methodAction(method: string) {
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "edit";
  if (method === "DELETE") return "delete";
  return "access";
}

function requestProduct(request: Request, fallback: ValueTechProductId): ValueTechProductId {
  const query = Array.isArray(request.query?.productId) ? request.query.productId[0] : request.query?.productId;
  return query === "machine-valuation" || query === "real-estate-valuation" ? query : fallback;
}

/** Maps protected API operations to the same stable keys shown in the permission matrix. */
export function permissionRequirementForRequest(request: Request): Requirement | null {
  const path = String(request.path || request.url || "").split("?")[0]!.toLowerCase();
  const method = request.method.toUpperCase();

  if (path.includes("/company/permissions")) return null;

  if (path.includes("/mv/data-extraction")) {
    return { productId: "machine-valuation", grant: `data_extraction.${methodAction(method)}` };
  }

  if (path.includes("/mv/projects") || path.includes("/mv/sheets") || path.includes("/mv/upload")) {
    if (path.includes("/attachment-jobs")) {
      const requestedScope = Array.isArray(request.query?.permissionScope)
        ? request.query.permissionScope[0]
        : request.query?.permissionScope;
      const bodyField = (request.body as { field?: unknown } | undefined)?.field;
      const valuationScope = bodyField !== undefined
        ? bodyField === "valuationAccountingWorkspace"
        : requestedScope === "valuation";
      return {
        productId: "machine-valuation",
        grant: valuationScope
          ? `valuation.${method === "GET" ? "access" : "upload"}`
          : `asset_media.${method === "GET" ? "access" : "upload"}`,
      };
    }
    if (/word-template|pptx-template|report/.test(path)) {
      const action = method === "GET" ? "download" : method === "DELETE" ? "edit" : "generate";
      return { productId: "machine-valuation", grant: `reports.${action}` };
    }
    if (/valuation/.test(path)) {
      const action = method === "GET" ? (path.includes("download") ? "download" : "access") : method === "POST" ? "upload" : "edit";
      return { productId: "machine-valuation", grant: `valuation.${action}` };
    }
    if (/asset-image|inspectorfiles|attachment|\/files/.test(path)) {
      const valuationAccounting = Array.isArray(request.query?.valuationAccounting)
        ? request.query.valuationAccounting[0]
        : request.query?.valuationAccounting;
      if (valuationAccounting === "1") {
        return { productId: "machine-valuation", grant: `valuation.${method === "GET" ? "access" : method === "POST" ? "upload" : methodAction(method)}` };
      }
      const disposition = Array.isArray(request.query?.attachment) ? request.query.attachment[0] : request.query?.attachment;
      const projectFileDownload = /\/files\/[^/]+\/download$/.test(path);
      const action = method === "GET" ? (projectFileDownload || disposition === "1" ? "download" : "access") : method === "POST" ? "upload" : methodAction(method);
      return { productId: "machine-valuation", grant: `asset_media.${action}` };
    }
    if (/inspectors|workflow/.test(path)) {
      return { productId: "machine-valuation", grant: `project_workflow.${method === "GET" ? "access" : path.includes("inspector") ? "assign" : "edit"}` };
    }
    if (/subproject|sheets|asset-import/.test(path)) {
      return { productId: "machine-valuation", grant: `asset_data.${path.includes("import") ? "import" : methodAction(method)}` };
    }
    if (method === "PATCH" && /^\/api\/mv\/projects\/[^/]+$/.test(path) && request.body) {
      const permissionScope = Array.isArray(request.query?.permissionScope)
        ? request.query.permissionScope[0]
        : request.query?.permissionScope;
      if (permissionScope === "reports") {
        return { productId: "machine-valuation", grant: "reports.edit" };
      }
      if ("valuationAccountingWorkspace" in request.body) {
        return { productId: "machine-valuation", grant: "valuation.edit" };
      }
      if ("clientDocumentsWorkspace" in request.body || "sceCertificateWorkspace" in request.body) {
        return { productId: "machine-valuation", grant: "asset_media.delete" };
      }
      if ("reportData" in request.body) {
        return { productId: "machine-valuation", grant: "project_workflow.edit" };
      }
    }
    const action = path.includes("duplicate") ? "duplicate" : /archive|restore|permanent/.test(path) ? "archive" : methodAction(method);
    return { productId: "machine-valuation", grant: `projects.${action}` };
  }

  if (path.includes("/assets")) {
    const action = path.includes("import") ? "import" : methodAction(method);
    return { productId: "machine-valuation", grant: `asset_data.${action}` };
  }

  if (path.includes("/mv/")) {
    return { productId: "machine-valuation", grant: `asset_data.${methodAction(method)}` };
  }

  if (path.includes("/transactions")) {
    if (/\/images|\/attachments/.test(path)) {
      const action = method === "GET" ? "access" : method === "POST" ? "upload" : methodAction(method);
      return { productId: "real-estate-valuation", grant: `property_media.${action}` };
    }
    if (/\/pdf/.test(path)) {
      const disposition = Array.isArray(request.query?.disposition)
        ? request.query.disposition[0]
        : request.query?.disposition;
      return {
        productId: "real-estate-valuation",
        grant: disposition === "attachment" || path.includes("download") ? "reports.download" : "reports.access",
      };
    }
    if (/\/inspectors/.test(path)) return { productId: "real-estate-valuation", grant: "transactions.assign" };
    if (/\/notes(?:\/|$)/.test(path)) {
      return { productId: "real-estate-valuation", grant: `transactions.${method === "GET" ? "access" : "edit"}` };
    }
    if (/completed|status/.test(path)) return { productId: "real-estate-valuation", grant: "transactions.status" };
    if (/\/core$/.test(path)) return { productId: "real-estate-valuation", grant: "valuation.edit" };
    if (/\/transactions\/[^/]+$/.test(path)) {
      if (method === "GET") return { productId: "real-estate-valuation", grant: "valuation.access" };
      if (method === "PATCH" || method === "PUT") return { productId: "real-estate-valuation", grant: "valuation.edit" };
    }
    return { productId: "real-estate-valuation", grant: `transactions.${methodAction(method)}` };
  }

  if (path.includes("/clients") || path.includes("/client-types") || path.includes("/form-templates")) {
    const productId = requestProduct(request, "real-estate-valuation");
    return { productId, grant: `clients.${methodAction(method)}` };
  }

  if (path.includes("/company/asset-descriptions")) {
    return { productId: "machine-valuation", grant: `settings_assets.${methodAction(method)}` };
  }
  if (path.includes("/company/admin/report-defaults") || path.includes("/company/real-estate-report-template")) {
    const productId = requestProduct(request, path.includes("real-estate") ? "real-estate-valuation" : "machine-valuation");
    return { productId, grant: `settings_reports.${method === "GET" ? "access" : "edit"}` };
  }
  if (path.includes("/company/admin/serial-numbering")) {
    return { productId: "machine-valuation", grant: `settings_serial.${method === "GET" ? "access" : "edit"}` };
  }

  return null;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    const requirement = permissionRequirementForRequest(request);
    if (!requirement) return true;

    const context = await resolveRequestContext(request);
    if (!context.user || !context.companyMembership) return true;
    if (context.user.role === "super_admin" || context.companyMembership.role === "company_admin") return true;

    const grants = await effectivePermissionGrants(await getMongoDb(), context, requirement.productId);
    if (grants === null || grants.includes(requirement.grant)) return true;
    throw new ForbiddenException("ليس لديك صلاحية لتنفيذ هذا الإجراء داخل هذا النظام.");
  }
}

