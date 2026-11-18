import type { GateLayout, SiteSurfaceLayout } from '../opo-site-surfaces';
import type { RegionId } from './regions';
import { songpaGateLayout } from './songpa-entrance';
import { songpaSurfaceLayout } from './songpa-grounds';

export const siteSurfaces: Partial<Record<RegionId, { layout: SiteSurfaceLayout; gate?: GateLayout }>> = {
  songpa: { layout: songpaSurfaceLayout, gate: songpaGateLayout },
};
