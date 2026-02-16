const isProduction = process.env.NODE_ENV === "production";

function readNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

function readBoolean(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

export const authTrackingConfig = {
  appName: "Spark Vision",
  identityCookieName: "sv_identity",
  sessionCookieName: "sv_session",
  csrfCookieName: "sv_csrf",
  localBackupStorageKey: "sv_local_uid",
  authSecret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "spark-vision-dev-secret-change-me",
  authCookieDays: readNumber("AUTH_COOKIE_DAYS", 730),
  sessionTimeoutMinutes: readNumber("SESSION_TIMEOUT_MINUTES", 30),
  rememberMeDays: readNumber("REMEMBER_ME_DAYS", 30),
  guestAttemptLimitDefault: readNumber("GUEST_ATTEMPT_LIMIT_DEFAULT", 5),
  registrationRequiredDefault: readBoolean("REGISTRATION_REQUIRED_DEFAULT", true),
  dataRetentionDaysDefault: readNumber("DATA_RETENTION_DAYS_DEFAULT", 180),
  trackingEnabledDefault: readBoolean("TRACKING_ENABLED_DEFAULT", true),
  superAdminUsername: process.env.SUPER_ADMIN_USERNAME ?? "admin000",
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? "admin000",
  isProduction,
  secureCookies: isProduction,
};

export type AuthTrackingConfig = typeof authTrackingConfig;
