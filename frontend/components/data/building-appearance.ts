import architecture from '../../public/opo-architecture.json';
import type { StreetFacade } from '../opo-street-exterior';
import type { RegionId } from './regions';
import { songpaArchitecture, type TowerExterior } from './songpa-architecture';
import { songpaStreetFacades } from './songpa-streets';

type RoofPavilion = { roofRiseM: number; mainRoofRiseM: number; coreFaces: number[][][] };
type BuildingAppearance = {
  streetFacades?: Map<string, StreetFacade>;
  towerCladding?: Map<string, TowerExterior>;
  roofPavilions?: Map<string, RoofPavilion>;
};

export const buildingAppearance: Partial<Record<RegionId, BuildingAppearance>> = {
  opo: { roofPavilions: new Map(architecture.towers.map(tower => [tower.outlineId, {
    roofRiseM: architecture.roofRiseM, mainRoofRiseM: architecture.mainRoofRiseM, coreFaces: tower.coreFaces,
  }])) },
  songpa: { streetFacades: songpaStreetFacades, towerCladding: songpaArchitecture.towers },
};
