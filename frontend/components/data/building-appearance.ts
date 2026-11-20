import architecture from '../../public/opo-architecture.json';
import type { StreetFacade } from '../opo-street-exterior';
import type { RegionId } from './regions';
import { songpaArchitecture, type TowerExterior } from './songpa-architecture';
import { songpaNeighborApartments, songpaStreetFacades } from './songpa-streets';
import type { NeighborhoodPalette } from '../opo-neighborhood-facade';

type RoofPavilion = { roofRiseM: number; mainRoofRiseM: number; coreFaces: number[][][] };
type BuildingAppearance = {
  streetFacades?: Map<string, StreetFacade>;
  neighborApartments?: Map<string, NeighborhoodPalette>;
  towerCladding?: Map<string, TowerExterior>;
  roofPavilions?: Map<string, RoofPavilion>;
};

export const buildingAppearance: Partial<Record<RegionId, BuildingAppearance>> = {
  opo: { roofPavilions: new Map(architecture.towers.map(tower => [tower.outlineId, {
    roofRiseM: architecture.roofRiseM, mainRoofRiseM: architecture.mainRoofRiseM, coreFaces: tower.coreFaces,
  }])) },
  songpa: { streetFacades: songpaStreetFacades, towerCladding: songpaArchitecture.towers, neighborApartments: songpaNeighborApartments },
};
