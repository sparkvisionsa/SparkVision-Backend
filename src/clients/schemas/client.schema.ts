import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema } from "mongoose";
import { CLIENTS_COLLECTION } from "@/server/models/clientsModule";

/** عميل — `_id` يُنشأ تلقائيًا في Atlas. */
@Schema({ collection: CLIENTS_COLLECTION, timestamps: true })
export class Client {
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  companyId!: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: [String], default: [] })
  productIds!: string[];

  @Prop({ type: String, default: "" })
  sharedClientId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ default: "" })
  phone!: string;

  @Prop({ default: "" })
  email!: string;

  @Prop({ default: true })
  active!: boolean;

  @Prop({ default: "" })
  address!: string;

  @Prop({ default: "" })
  clientAddress!: string;

  @Prop({ default: "" })
  bankName!: string;

  @Prop({ default: "" })
  bankAccountAddress!: string;

  @Prop({ default: "" })
  bankAccountNumber!: string;

  @Prop({ type: Object, default: {} })
  templateFieldValues!: Record<string, string>;

  @Prop({ type: Object, default: {} })
  systemData!: Record<string, Record<string, unknown>>;

  @Prop({ required: true })
  clientTypeId!: string;

  @Prop({ type: String, default: null })
  formTemplateId!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ClientDocument = HydratedDocument<Client>;
export const ClientSchema = SchemaFactory.createForClass(Client);
