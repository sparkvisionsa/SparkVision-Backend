import { Module } from "@nestjs/common";
import {
  CitiesController,
  LocationsSeedController,
  NeighborhoodsController,
  RegionsController,
} from "./locations.controller";
import { LocationsService } from "./locations.service";

@Module({
  controllers: [
    RegionsController,
    CitiesController,
    NeighborhoodsController,
    LocationsSeedController,
  ],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
