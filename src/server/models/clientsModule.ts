import type { ObjectId } from "mongodb";

/** MongoDB collection names for Value Tech clients UI */
export const CLIENT_TYPES_COLLECTION = "client_types";
export const FORM_TEMPLATES_COLLECTION = "form_templates";
export const CLIENTS_COLLECTION = "clients";

export type TemplateFieldType =
  | "text"
  | "number"
  | "date"
  | "textarea"
  | "email"
  | "tel"
  | "select"
  | "file"
  | "region"
  | "city"
  | "neighborhood";

export type FormFieldDoc = {
  id: string;
  label: string;
  fieldType: TemplateFieldType;
  /** عندما يكون النوع `select`: النصوص التي تظهر في القائمة المنسدلة وتُحفظ كقيمة عند الاختيار */
  options?: string[];
  multiple?: boolean;
};

/**
 * حقول إنشاء/تحديث العميل بدون معرف مستند —
 * `_id` و`createdAt` و`updatedAt` يضيفها MongoDB/Mongoose تلقائيًا.
 */
export interface ClientUpsertFields {
  name: string;
  phone: string;
  email: string;
  active: boolean;
  address: string;
  clientAddress: string;
  bankName: string;
  bankAccountAddress: string;
  bankAccountNumber: string;
  templateFieldValues: Record<string, string>;
  clientTypeId: string;
  formTemplateId: string | null;
}

/** MongoDB document shape */
export interface ClientMongoDoc extends ClientUpsertFields {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Shape of a client document as returned by the API/service layer */
export interface ClientDoc {
  id: string;
  name: string;
  phone: string;
  email: string;
  active: boolean;
  clientTypeId: string;
  address: string;
  clientAddress: string;
  formTemplateId: string | null;
  templateFieldValues: Record<string, string>;
  bankName: string;
  bankAccountAddress: string;
  bankAccountNumber: string;
  createdAt: string;
  updatedAt: string;
}

/** MongoDB form template document */
export interface FormTemplateMongoDoc {
  _id?: ObjectId;
  name: string;
  fields: FormFieldDoc[];
  createdAt?: Date;
  updatedAt?: Date;
}

/** Shape of a form template document as returned by the API/service layer */
export interface FormTemplateDoc {
  id: string;
  name: string;
  fields: FormFieldDoc[];
  createdAt: string;
  updatedAt: string;
}
