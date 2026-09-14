/** Flatten the report form's team field into text suitable for a template variable. */
export function formatReportTemplateTeam(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const member = item as Record<string, unknown>;
    const parts = [member.name, member.title, member.membershipNo, member.role]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim().slice(0, 500));
    return parts.length ? [parts.join(" — ")] : [];
  }).join("\n");
}
