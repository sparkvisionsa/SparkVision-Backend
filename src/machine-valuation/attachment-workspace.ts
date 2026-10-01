export const ATTACHMENT_FIELDS = ["valuationAccountingWorkspace", "clientDocumentsWorkspace", "sceCertificateWorkspace"] as const;
export type AttachmentField = typeof ATTACHMENT_FIELDS[number];

/** An atomic append, or a replacement that preserves rows the editor has never seen. */
export function attachmentWorkspaceUpdate(field: AttachmentField, incoming: Record<string, unknown>, known?: { sources: string[]; images: string[] }) {
  const arrays = Object.fromEntries(["sources", "images"].map(key => {
    const rows = (incoming[key] ?? []) as Array<{ id: string }>;
    const replaced = [...new Set([...(known?.[key as "sources" | "images"] ?? []), ...rows.map(row => row.id)])];
    return [key, { $concatArrays: [
      { $filter: { input: { $ifNull: [`$${field}.${key}`, []] }, as: "row", cond: { $not: [{ $in: ["$$row.id", { $literal: replaced }] }] } } },
      { $literal: rows },
    ] }];
  }));
  return { $mergeObjects: [
    { version: 1, includeInReport: true },
    { $ifNull: [`$${field}`, {}] },
    { $literal: Object.fromEntries(Object.entries(incoming).filter(([key]) => key !== "sources" && key !== "images")) },
    arrays,
  ] };
}
