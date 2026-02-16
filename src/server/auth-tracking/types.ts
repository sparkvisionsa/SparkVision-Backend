export type UserRole = "user" | "super_admin";

export interface UserDoc {
  _id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
  isBlocked: boolean;
  blockedAt?: Date | null;
}

export interface UserProfileDoc {
  _id?: string;
  userId: string;
  email?: string | null;
  phone?: string | null;
  additionalInfo?: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface SessionDeviceInfo {
  type: "mobile" | "tablet" | "desktop" | "bot" | "unknown";
  os: string;
  browser: string;
  screenResolution?: string;
  language?: string;
}

export interface SessionGeoInfo {
  ipAddress: string;
  country?: string;
  city?: string;
  region?: string;
}

export interface SessionDoc {
  _id: string;
  userId?: string | null;
  identityId: string;
  fingerprintId: string;
  localBackupId?: string | null;
  userAgent: string;
  device: SessionDeviceInfo;
  geo: SessionGeoInfo;
  referrer?: string | null;
  firstVisitAt: Date;
  startTime: Date;
  lastSeenAt: Date;
  endTime?: Date | null;
  durationMs: number;
  idleMs: number;
  activeMs: number;
  isActive: boolean;
  isRemembered: boolean;
  metadata?: Record<string, unknown>;
}

export interface ActivityDoc {
  _id?: string;
  activityId: string;
  userIdentifier: string;
  userId?: string | null;
  sessionId: string;
  actionType: string;
  actionDetails?: Record<string, unknown>;
  timestamp: Date;
  pageUrl?: string;
  route?: string;
  referrer?: string | null;
  userAgent?: string;
  ipAddress?: string;
}

export interface GuestAttemptDoc {
  _id?: string;
  identityId: string;
  fingerprintId: string;
  attemptCount: number;
  firstVisit: Date;
  lastVisit: Date;
}

export interface AdminConfigDoc {
  _id: "system";
  guestAttemptLimit: number;
  registrationRequired: boolean;
  sessionTimeoutMinutes: number;
  dataRetentionDays: number;
  updatedAt: Date;
  updatedBy: string;
  enableTracking: boolean;
}

export interface BlockedEntityDoc {
  _id?: string;
  entityType: "identity" | "user";
  entityId: string;
  reason?: string;
  blockedAt: Date;
  blockedBy: string;
}

export interface TrackingActionInput {
  actionType: string;
  actionDetails?: Record<string, unknown>;
  pageUrl?: string;
  route?: string;
  timestamp?: string;
}

export interface SessionPayloadInput {
  eventType: "start" | "heartbeat" | "end";
  pageUrl?: string;
  referrer?: string;
  localBackupId?: string;
  fingerprint?: {
    canvas?: string;
    webgl?: string;
    audio?: string;
    timezone?: string;
    platform?: string;
    language?: string;
    screenResolution?: string;
    deviceMemory?: string;
    hardwareConcurrency?: string;
  };
  activeMs?: number;
  idleMs?: number;
  durationMs?: number;
}

export interface GuestAccessStatus {
  limit: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  registrationRequired: boolean;
  isBlocked: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string | null;
}
