import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { FORM_TEMPLATES_COLLECTION } from "@/server/models/clientsModule";
import { FormField, FormFieldSchema } from "./form-field.schema";

/** قالب نماذج — `_id` من الخادم فقط. */
@Schema({ collection: FORM_TEMPLATES_COLLECTION, timestamps: true })
export class FormTemplate {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [FormFieldSchema], default: [] })
  fields!: FormField[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type FormTemplateDocument = HydratedDocument<FormTemplate>;
export const FormTemplateSchema = SchemaFactory.createForClass(FormTemplate);
