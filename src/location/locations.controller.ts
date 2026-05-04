import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { LocationsService } from "./locations.service";

// ─── Regions ──────────────────────────────────────────────────────────────────

@Controller("locations/regions")
export class RegionsController {
  constructor(private readonly svc: LocationsService) {}

  @Get()
  list() {
    return this.svc.listRegions();
  }

  @Post()
  create(@Body() body: { titleAr?: string; titleEn?: string }) {
    return this.svc.createRegion(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: { titleAr?: string; titleEn?: string },
  ) {
    return this.svc.updateRegion(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.deleteRegion(id);
  }
}

// ─── Cities ───────────────────────────────────────────────────────────────────

@Controller("locations/cities")
export class CitiesController {
  constructor(private readonly svc: LocationsService) {}

  @Get()
  list(@Query("regionId") regionId?: string) {
    return this.svc.listCities(regionId);
  }

  @Post()
  create(
    @Body()
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      active?: boolean;
    },
  ) {
    return this.svc.createCity(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body()
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      active?: boolean;
    },
  ) {
    return this.svc.updateCity(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.deleteCity(id);
  }
}

// ─── Neighborhoods ────────────────────────────────────────────────────────────

@Controller("locations/neighborhoods")
export class NeighborhoodsController {
  constructor(private readonly svc: LocationsService) {}

  @Get()
  list(@Query("regionId") regionId?: string, @Query("cityId") cityId?: string) {
    return this.svc.listNeighborhoods(regionId, cityId);
  }

  @Post()
  create(
    @Body()
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      cityId?: string;
      active?: boolean;
    },
  ) {
    return this.svc.createNeighborhood(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body()
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      cityId?: string;
      active?: boolean;
    },
  ) {
    return this.svc.updateNeighborhood(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.deleteNeighborhood(id);
  }
}

// ─── Seed endpoint (admin-only, call once) ────────────────────────────────────
// POST /api/locations/seed  { regions: [...], cities: [...], neighborhoods: [...] }
@Controller("locations/seed")
export class LocationsSeedController {
  constructor(private readonly svc: LocationsService) {}

  @Post()
  async seed(
    @Body()
    body: {
      regions?: Array<{ titleAr: string; titleEn: string }>;
      cities?: Array<{
        titleAr: string;
        titleEn: string;
        regionId: string;
        active: boolean;
      }>;
      neighborhoods?: Array<{
        titleAr: string;
        titleEn: string;
        regionId: string;
        cityId: string;
        active: boolean;
      }>;
    },
  ) {
    const results: Record<string, unknown> = {};
    if (body.regions?.length) {
      results.regions = await this.svc.bulkSeedRegions(body.regions);
    }
    if (body.cities?.length) {
      results.cities = await this.svc.bulkSeedCities(body.cities);
    }
    if (body.neighborhoods?.length) {
      results.neighborhoods = await this.svc.bulkSeedNeighborhoods(
        body.neighborhoods,
      );
    }
    return results;
  }
}
