import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema } from "mongoose";
import { FORM_TEMPLATES_COLLECTION } from "@/server/models/clientsModule";
import { FormField, FormFieldSchema } from "./form-field.schema";

/** قالب نماذج — `_id` من الخادم فقط. */
@Schema({ collection: FORM_TEMPLATES_COLLECTION, timestamps: true })
export class FormTemplate {
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  companyId!: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: String, default: "real-estate-valuation", index: true })
  productId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [FormFieldSchema], default: [] })
  fields!: FormField[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type FormTemplateDocument = HydratedDocument<FormTemplate>;
export const FormTemplateSchema = SchemaFactory.createForClass(FormTemplate);
