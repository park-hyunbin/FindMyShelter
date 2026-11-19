import type { SiteSurfaceLayout } from '../opo-site-surfaces';
import type { RegionId } from './regions';
import { songpaSurfaceLayout } from './songpa-grounds';

export const siteSurfaces: Partial<Record<RegionId, { layout: SiteSurfaceLayout }>> = {
  songpa: { layout: songpaSurfaceLayout },
};
