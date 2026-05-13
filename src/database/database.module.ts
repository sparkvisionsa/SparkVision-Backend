import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { applyMongoDnsFromEnv } from "@/server/mongodb";

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => {
        applyMongoDnsFromEnv();
        const uri = process.env.MONGO_URL_SCRAPPING;
        const dbName = process.env.MONGO_DBNAME_SCRAPPING;
        if (!uri) {
          throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
        }
        if (!dbName) {
          throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
        }
        return {
          uri,
          dbName,
          serverSelectionTimeoutMS: 30_000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
