import type { ObjectId, WithId } from "mongodb";

export type UserRole =
  | "user"
  | "super_admin"
  | "company_admin"
  | "valuer"
  | "data_entry"
  | "reviewer"
  | "inspector";

/** Value Tech product slugs granted to a company (and inherited by its users). */
export type ValueTechProductId =
  | "real-estate-valuation"
  | "machine-valuation"
  | "evaluation-source"
  | "value-tech-app"
  | "asset-inventory"
  | "asset-inspection";

/** صف مقيّم/توقيع افتراضي للشركة (يُعرض في تقارير تقييم الآلات). */
export interface CompanyReportSignatoryRow {
  id: string;
  name: string;
  roleLabel: string;
  signatureImageDataUrl: string;
}

/**
 * قسم نطاق العمل والقيود ضمن قوالب التقرير الافتراضية للشركة.
 * تُستخدم هذه القيم كنصوص افتراضية في صفحات إعداد التقرير عند عدم وجود إدخال خاص بالمشروع.
 */
export interface CompanyReportScopeDefaults {
  /** تفاصيل نطاق العمل الافتراضية (نص متعدد الأسطر). */
  scopeOfWorkDetails?: string;
  /** تعريف/توضيح أساس القيمة. */
  valuationBasisDefinition?: string;
  /** تعريف/توضيح فرضية القيمة (12.0). */
  valuePremiseDefinition?: string;
  /** قيود الاستخدام/التوزيع/النشر. */
  useRestriction?: string;
  /** الاستعانة بأخصائيين خارجيين. */
  externalSpecialistUse?: string;
  /** اعتبارات ESG. */
  esgConsiderations?: string;
  /** مصادر المعلومات والمدخلات الرئيسية. */
  informationSources?: string;
  /**
   * بيان الامتثال لمعايير التقييم الدولية (قسم 3.0). نص ثابت غالباً عبر مشاريع
   * الشركة، يمكن تخصيصه ليعكس الاتفاقيات الموقعة.
   */
  complianceStatement?: string;
  /**
   * إقرار الاستقلالية وعدم تضارب المصالح (قسم 4.0). يحتوي على اسم الشركة
   * تلقائياً عبر استبدال `{companyName}` في وقت العرض.
   */
  independenceStatement?: string;
  /** نص افتراضي للاستخدام المقصود (قسم 10.0). */
  intendedUseStatement?: string;
}

/**
 * قسم الأصل والمنهجية ضمن قوالب التقرير الافتراضية للشركة.
 * (موقع المعاينة ورابطها يبقيان ضمن بيانات المشروع وليس قوالب الشركة.)
 */
export interface CompanyReportMethodologyDefaults {
  /** الوصف العام للأصل محل التقييم (نص افتراضي). */
  assetSubjectDescription?: string;
  /** الوصف التفصيلي للأصول. */
  assetDetailedDescription?: string;
  /** مبررات اختيار المنهجية (قسم 21.0). */
  methodologyRationale?: string;
  /** تفاصيل تطبيق أسلوب التكلفة (قسم 22.0). */
  costApproachDetails?: string;
  /** القيمة المتبقية / التخريدية (قسم 22.1). */
  salvageValueDescription?: string;
  /** الإهلاك المادي وطرق احتسابه (قسم 22.2). */
  physicalDepreciationDescription?: string;
  /** التقادم الوظيفي (قسم 22.3). */
  functionalObsolescenceDescription?: string;
  /** التقادم الاقتصادي (قسم 22.4). */
  economicObsolescenceDescription?: string;
}

/** قسم الافتراضات (عامة وخاصة) ضمن قوالب التقرير الافتراضية للشركة. */
export interface CompanyReportAssumptionsDefaults {
  /** افتراضات عامة (سابقاً «افتراضات مهمة»). */
  generalAssumptions?: string;
  /** افتراضات خاصة. */
  specialAssumptions?: string;
}

/** قوالب التقرير النهائي الافتراضية على مستوى الشركة. */
export interface CompanyReportDefaults {
  scope?: CompanyReportScopeDefaults;
  methodology?: CompanyReportMethodologyDefaults;
  assumptions?: CompanyReportAssumptionsDefaults;
}

/**
 * حقول شركة في `companies` — لا تُعرّف `_id` هنا؛ Atlas/MongoDB يُنشئانه تلقائياً عند الإدراج.
 * للقراءة استخدم `WithId<CompanyDoc>` أو `CompanyMongoDoc`.
 */
export interface CompanyDoc {
  name: string;
  valueTechProductIds: ValueTechProductId[];
  /** مسؤول الشركة — نفس `users._id`؛ يوجد أيضاً صف عضوية `company_admin` في `user_company_memberships`. */
  adminUserId?: ObjectId;
  /** شعار الشركة كـ data URL (يفضّل PNG). */
  logoDataUrl?: string | null;
  /** المقيمون والتوقيعات الافتراضية لمشاريع التقييم. */
  reportSignatoryRows?: CompanyReportSignatoryRow[];
  /** قوالب أقسام التقرير النهائي الافتراضية (نطاق العمل، المنهجية، الافتراضات). */
  reportDefaults?: CompanyReportDefaults;
  /**
   * عدّاد ترقيم تسلسلي للمشاريع داخل الشركة (1, 2, 3, ...).
   * يُستخدم في الزيادة الذرية عند إنشاء مشروع لإنتاج `displayNumber`.
   */
  projectSequenceCounter?: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: ObjectId;
}

/** مستند شركة كما يُسترجع من MongoDB (يضم `_id` المولَّد). */
export type CompanyMongoDoc = WithId<CompanyDoc>;

/** دور المستخدم داخل شركة معيّنة (المصدر عند التفويض داخل الشركة). */
export type CompanyMembershipRole =
  | "company_admin"
  | "valuer"
  | "data_entry"
  | "reviewer"
  | "inspector";

/** أعضاء الشركة باستثناء `company_admin` — للتحقق من الـ API وتجميع العدّ والفلترة. */
export const COMPANY_MEMBER_ROLES: readonly CompanyMembershipRole[] = [
  "valuer",
  "data_entry",
  "reviewer",
  "inspector",
];

/**
 * حقول عضوية مستخدم في شركة — `_id` يُولَّد تلقائياً في Atlas.
 * المفتاح المنطقي: (`userId`, `companyId`).
 */
export interface UserCompanyMembershipDoc {
  userId: ObjectId;
  companyId: ObjectId;
  role: CompanyMembershipRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserCompanyMembershipMongoDoc = WithId<UserCompanyMembershipDoc>;

/**
 * حقول مستخدم في `users` — لا تُعرّف `_id`؛ يُنشَأ تلقائياً في Atlas.
 * `company` يشير إلى الشركة الأساسية (نفس منطق العضوية النشطة عادةً).
 * يبقى `user_company_memberships` مصدر الصلاحيات التفصيلي؛ يُمزامن `role` و`company` مع العضوية عند الإنشاء والإقلاع.
 */
export interface UserDoc {
  username: string;
  usernameLower: string;
  passwordHash: string;
  email?: string | null;
  phone?: string | null;
  /**
   * الدور الظاهر في الشركة: `super_admin`، أو `company_admin`، أو أحد أدوار العضو: `valuer` / `data_entry` / `reviewer` / `inspector`.
   * يُحدَّث ليتوافق مع `user_company_memberships` للشركة الأساسية.
   */
  role: UserRole;
  /** مرجع `companies._id` للشركة الأساسية (غير موجود لسوبر الأدمن). ربط الشركات التفصيلي في `user_company_memberships.companyId`. */
  company?: ObjectId | null;
  /**
   * توقيع تقرير تقييم الآلات (PNG كـ data URL) — يُدار من لوحة مدير الشركة.
   */
  valuationReportSignatureDataUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
  isBlocked: boolean;
  blockedAt?: Date | null;
}

/** مستخدم كما يُسترجع من MongoDB (يضم `_id`). */
export type UserMongoDoc = WithId<UserDoc>;

export interface UserProfileDoc {
  userId: ObjectId;
  email?: string | null;
  phone?: string | null;
  additionalInfo?: Record<string, unknown> | null;
  updatedAt: Date;
}

export type UserProfileMongoDoc = WithId<UserProfileDoc>;

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
  userId?: ObjectId | null;
  /** الشركة النشطة في الواجهة (مستخدم عضو فيها). */
  activeCompanyId?: ObjectId | null;
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
  activityId: string;
  userIdentifier: string;
  /** نص hex لـ `users._id` (سجل النشاط يبقى قابلاً للقراءة في التصدير). */
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

/**
 * ملف مستخدم للـ API — بدون حقل `_id` BSON؛ `id` هو معرّف وثيقة `user_profiles` عند وجودها.
 */
export interface PublicUserProfile {
  id?: string;
  userId: string;
  email?: string | null;
  phone?: string | null;
  additionalInfo?: Record<string, unknown> | null;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  /** الدور الفعّال في `companyId` النشط (من العضوية أو سوبر أدمن). */
  role: UserRole;
  /** الشركة النشطة في الجلسة (نفس `companies._id` كنص). */
  companyId?: string | null;
  /** كل الشركات المرتبطة بالمستخدم (عضويات). */
  companyIds: string[];
  companyName?: string | null;
  /** When null, all Value Tech products are allowed (super admin or legacy user). */
  valueTechProductIds: string[] | null;
  createdAt: string;
  lastLoginAt?: string | null;
}
