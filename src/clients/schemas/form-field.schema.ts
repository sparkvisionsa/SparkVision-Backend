import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

/** حقول النموذج المضمّنة — بدون `_id` من MongoDB؛ الحقل `id` معرف من التطبيق (UUID). */
const TEMPLATE_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "textarea",
  "email",
  "tel",
  "select",
] as const;

@Schema({ _id: false })
export class FormField {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true, enum: TEMPLATE_FIELD_TYPES })
  fieldType!: string;

  @Prop({ type: [String] })
  options?: string[];
}

export const FormFieldSchema = SchemaFactory.createForClass(FormField);
