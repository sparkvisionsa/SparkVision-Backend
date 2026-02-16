import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { parseBoolean, parseNumber, parseSources, readQueryString } from "@/common/query-utils";
import {
  listCarsSources,
  type CarsSourcesListQuery,
} from "@/server/controllers/carsSourceController";
import {
  getHarajScrapeById,
  listHarajScrapes,
  type HarajScrapeListQuery,
} from "@/server/controllers/harajScrapeController";
import {
  getYallaMotorById,
  listYallaMotors,
  type YallaMotorListQuery,
} from "@/server/controllers/yallaMotorController";
import { applyContextCookies } from "@/server/auth-tracking/context";
import { enforceGuestAccess } from "@/server/auth-tracking/service";

function parseFields(value?: string) {
  return value === "options" || value === "modelYears" ? value : undefined;
}

function parseCountMode(value?: string) {
  return value === "none" ? "none" : "exact";
}

function parseHarajLikeQuery(req: Request): HarajScrapeListQuery {
  return {
    search: readQueryString(req, "search"),
    exactSearch:
      parseBoolean(readQueryString(req, "exactSearch")) ??
      parseBoolean(readQueryString(req, "match")),
    city: readQueryString(req, "city"),
    minPrice: parseNumber(readQueryString(req, "minPrice")),
    maxPrice: parseNumber(readQueryString(req, "maxPrice")),
    hasImage: parseBoolean(readQueryString(req, "hasImage")),
    hasPrice: parseBoolean(readQueryString(req, "hasPrice")),
    hasComments: parseBoolean(readQueryString(req, "hasComments")),
    hasMileage: parseBoolean(readQueryString(req, "hasMileage")),
    dateFrom: readQueryString(req, "dateFrom"),
    dateTo: readQueryString(req, "dateTo"),
    sort: readQueryString(req, "sort"),
    page: parseNumber(readQueryString(req, "page")),
    limit: parseNumber(readQueryString(req, "limit")),
    tag0: readQueryString(req, "tag0"),
    tag1: readQueryString(req, "tag1"),
    tag2: readQueryString(req, "tag2"),
    carModelYear: parseNumber(readQueryString(req, "carModelYear")),
    mileage: parseNumber(readQueryString(req, "mileage")),
    mileageMin: parseNumber(readQueryString(req, "mileageMin")),
    mileageMax: parseNumber(readQueryString(req, "mileageMax")),
    excludeTag1: readQueryString(req, "excludeTag1"),
    fields: parseFields(readQueryString(req, "fields")),
    countMode: parseCountMode(readQueryString(req, "countMode")),
  };
}

function parseCarsSourcesQuery(req: Request): CarsSourcesListQuery {
  return {
    ...parseHarajLikeQuery(req),
    sources: parseSources(readQueryString(req, "sources")),
  };
}

@Controller()
export class SourcesController {
  @Get("cars-sources")
  async listCarsSourcesRoute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const fields = readQueryString(req, "fields");
    const guard = await enforceGuestAccess(req, {
      incrementAttempt: fields !== "options" && fields !== "modelYears",
      attemptReason: "cars_sources_query",
    });
    applyContextCookies(res, guard.context);
    return listCarsSources(parseCarsSourcesQuery(req));
  }

  @Get("haraj-scrape")
  async listHarajScrapesRoute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const fields = readQueryString(req, "fields");
    const guard = await enforceGuestAccess(req, {
      incrementAttempt: fields !== "options" && fields !== "modelYears",
      attemptReason: "haraj_query",
    });
    applyContextCookies(res, guard.context);
    return listHarajScrapes(parseHarajLikeQuery(req));
  }

  @Get("haraj-scrape/:id")
  async getHarajScrapeByIdRoute(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const guard = await enforceGuestAccess(req, {
      incrementAttempt: false,
      attemptReason: "haraj_detail",
    });
    applyContextCookies(res, guard.context);

    const doc = await getHarajScrapeById(id);
    if (!doc) {
      res.status(404);
      return { error: "Not found" };
    }
    return doc;
  }

  @Get("yallamotor-scrape")
  async listYallaMotorsRoute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const fields = readQueryString(req, "fields");
    const guard = await enforceGuestAccess(req, {
      incrementAttempt: fields !== "options" && fields !== "modelYears",
      attemptReason: "yallamotor_query",
    });
    applyContextCookies(res, guard.context);
    return listYallaMotors(parseHarajLikeQuery(req) as YallaMotorListQuery);
  }

  @Get("yallamotor-scrape/:id")
  async getYallaMotorByIdRoute(
    @Param("id") id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const guard = await enforceGuestAccess(req, {
      incrementAttempt: false,
      attemptReason: "yallamotor_detail",
    });
    applyContextCookies(res, guard.context);

    const doc = await getYallaMotorById(id);
    if (!doc) {
      res.status(404);
      return { error: "Not found" };
    }
    return doc;
  }
}
