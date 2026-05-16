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

export interface FormTemplateDoc {
  _id?: ObjectId;
  name: string;
  fields: FormFieldDoc[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ClientDoc extends ClientUpsertFields {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
