import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { CLIENT_TYPES_COLLECTION } from "@/server/models/clientsModule";

/** نوع عميل — `_id` يُولَّد من MongoDB/Atlas فقط (لا يُعرَّف في المخطط). */
@Schema({
  collection: CLIENT_TYPES_COLLECTION,
  timestamps: { createdAt: true, updatedAt: false },
})
export class ClientType {
  @Prop({ required: true, trim: true })
  name!: string;

  /** يُدار بواسطة Mongoose timestamps — لا يُمرَّر عند الإنشاء */
  createdAt!: Date;
}

export type ClientTypeDocument = HydratedDocument<ClientType>;
export const ClientTypeSchema = SchemaFactory.createForClass(ClientType);
