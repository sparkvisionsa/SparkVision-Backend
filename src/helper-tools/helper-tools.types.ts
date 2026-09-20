import type { ObjectId } from "mongodb";

export type RecorderSurface = "system" | "any";
export type HelperOwnerKind = "user" | "guest";

export type HelperActor = {
  kind: HelperOwnerKind;
  userId: string | null;
  companyId: string | null;
  sessionId: string;
  displayName: string;
  identityId: string;
};

export type HelperRecordingDoc = {
  _id: ObjectId;
  ownerKind: HelperOwnerKind;
  ownerLabel: string;
  userId: string | null;
  companyId: string | null;
  sessionId: string;
  identityId: string;
  source: RecorderSurface;
  seconds: number;
  description: string;
  mime: string;
  size: number;
  fileId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type HelperRecordingUpload = {
  _id: string;
  actorKey: string;
  source: RecorderSurface;
  seconds: number;
  description: string;
  mime: string;
  name: string;
  size: number;
  offset: number;
  path: string;
  state: "active" | "writing";
  createdAt: Date;
  expiresAt: Date;
};

export const GUEST_OWNER_LABEL = "ضيف";
export const HELPER_RECORDING_MAX_BYTES = 1024 * 1024 * 1024;
export const HELPER_RECORDING_CHUNK_BYTES = 3 * 1024 * 1024;
export const HELPER_RECORDINGS_COLLECTION = "helper_screen_recordings";
export const HELPER_UPLOADS_COLLECTION = "helper_recording_uploads";
export const HELPER_RECORDINGS_BUCKET = "helper_recordings";

export function helperActorKey(actor: HelperActor) {
  return actor.kind === "user"
    ? `user:${actor.userId}:${actor.companyId ?? ""}`
    : `guest:${actor.sessionId}`;
}

export function helperVisibilityFilter(actor: HelperActor) {
  if (actor.kind === "user") {
    return {
      ownerKind: "user" as const,
      userId: actor.userId,
      companyId: actor.companyId,
    };
  }
  return {
    ownerKind: "guest" as const,
    sessionId: actor.sessionId,
  };
}

export function helperCanAccess(
  record: Pick<HelperRecordingDoc, "ownerKind" | "userId" | "companyId" | "sessionId">,
  actor: HelperActor,
) {
  if (actor.kind === "user") {
    return record.ownerKind === "user" && record.userId === actor.userId && record.companyId === actor.companyId;
  }
  return record.ownerKind === "guest" && record.sessionId === actor.sessionId;
}
