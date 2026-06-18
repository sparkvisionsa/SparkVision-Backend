import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Schema as MongooseSchema } from "mongoose";
import { CLIENT_TYPES_COLLECTION } from "@/server/models/clientsModule";

/** نوع عميل — `_id` يُولَّد من MongoDB/Atlas فقط (لا يُعرَّف في المخطط). */
@Schema({
  collection: CLIENT_TYPES_COLLECTION,
  timestamps: { createdAt: true, updatedAt: false },
})
export class ClientType {
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  companyId!: MongooseSchema.Types.ObjectId | null;

  @Prop({ type: String, default: "real-estate-valuation", index: true })
  productId!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  /** يُدار بواسطة Mongoose timestamps — لا يُمرَّر عند الإنشاء */
  createdAt!: Date;
}

export type ClientTypeDocument = HydratedDocument<ClientType>;
export const ClientTypeSchema = SchemaFactory.createForClass(ClientType);
