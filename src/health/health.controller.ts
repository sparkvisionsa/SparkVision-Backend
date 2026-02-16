import { Controller, Get } from "@nestjs/common";
import { getMongoDb } from "@/server/mongodb";

@Controller("health")
export class HealthController {
  @Get()
  async health() {
    try {
      const db = await getMongoDb();
      await db.command({ ping: 1 });
      return {
        status: "ok",
        database: "up",
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: "degraded",
        database: "down",
        timestamp: new Date().toISOString(),
      };
    }
  }
}
