import type { SiteSurfaceLayout } from '../opo-site-surfaces';
import type { RegionId } from './regions';
import { songpaSurfaceLayout } from './songpa-grounds';
import jamsilLandscape from '../../public/datasets/regions/jamsil-leel/landscape.json';

export const siteSurfaces: Partial<Record<RegionId, { layout: SiteSurfaceLayout }>> = {
  songpa: { layout: songpaSurfaceLayout },
  'jamsil-leel': {
    layout: {
      paths: [],
      walkSurfaces: jamsilLandscape.walkSurfaces.map(area => area.map(ring => ring.map(([lon, lat]) => [lon, lat]))),
    },
  },
};
