import * as T from 'three';
import type { BuildingFacadeKind } from './data/building-use-code';
import type { Point } from './opo-data';
import { facadeUV, withFacadeDistance, type NeighborhoodPalette } from './opo-neighborhood-facade';

export type LowRiseKind = Exclude<BuildingFacadeKind, 'apartment' | 'unknown'>;
type Opening = readonly [width: number, height: number, panes: number, offset?: number];
type Preset = {
  bayM: number;
  minWallM: number;
  palettes: readonly NeighborhoodPalette[];
  upper: readonly [Opening, Opening, Opening, Opening];
  ground: Opening;
};

export const lowRisePresets: Record<LowRiseKind, Preset> = {
  villa: {
    bayM: 3.6, minWallM: 2.05,
    palettes: [
      { wall: '#e3cfb7', trim: '#a48975', glass: '#6a8384', roof: '#786e64' },
      { wall: '#d6b4a2', trim: '#a68978', glass: '#637d80', roof: '#806b62' },
      { wall: '#bc9482', trim: '#e0c8b2', glass: '#5d7174', roof: '#806961' },
    ],
    upper: [[76, 59, 2, -5], [84, 73, 3], [52, 62, 2, 10], [74, 49, 2, 4]], ground: [62, 57, 2],
  },
  detached: {
    bayM: 5.3, minWallM: 2.55,
    palettes: [{ wall: '#e7d4ba', trim: '#ab8d72', glass: '#6b8380', roof: '#a17a62' }],
    upper: [[71, 65, 2], [84, 60, 2, 5], [75, 67, 2, -5], [69, 61, 2]], ground: [76, 65, 2],
  },
  residential: {
    bayM: 4.5, minWallM: 2.4,
    palettes: [{ wall: '#ddd1bc', trim: '#a79b88', glass: '#718483', roof: '#8b8074' }],
    upper: [[66, 51, 2], [69, 55, 2, 4], [56, 48, 2, -5], [66, 54, 2]], ground: [65, 53, 2],
  },
  commercial: {
    bayM: 4.2, minWallM: 2.6,
    palettes: [{ wall: '#d3ccbd', trim: '#948d82', glass: '#667c82', roof: '#757e7c' }],
    upper: [[88, 60, 3], [88, 60, 3], [85, 57, 3], [88, 60, 3]], ground: [87, 72, 3],
  },
  shop: {
    bayM: 4, minWallM: 2.45,
    palettes: [{ wall: '#dcc7ad', trim: '#a88770', glass: '#677e7f', roof: '#7c786d' }],
    upper: [[75, 56, 2], [84, 61, 3], [75, 56, 2], [84, 61, 3]], ground: [65, 52, 2],
  },
};

export function lowRiseFacadeUV(kind: LowRiseKind, outline: Point[], floorHeight: number, skirt: number) {
  const preset = lowRisePresets[kind];
  let front: [Point, Point] | undefined;
  if (kind === 'detached' || kind === 'shop') {
    let longest = preset.minWallM;
    for (const [index, point] of outline.entries()) {
      const next = outline[(index + 1) % outline.length];
      const length = Math.hypot(next.x - point.x, next.z - point.z);
      if (length <= longest) continue;
      front = [point, next];
      longest = length;
    }
  }
  return facadeUV(preset.bayM, floorHeight, skirt, undefined, { minWallM: preset.minWallM, front });
}

const tile = 128;

function drawOpening(ctx: CanvasRenderingContext2D, x: number, y: number, style: NeighborhoodPalette,
  [width, height, panes, offset = 0]: Opening, feature: 'window' | 'balcony' | 'door' | 'display') {
  const left = x + (tile - width) / 2 + offset;
  const top = y + (feature === 'door' || feature === 'display' ? 117 - height : (tile - height) / 2 - 3);
  ctx.fillStyle = style.trim;
  ctx.fillRect(left - 3, top - 3, width + 6, height + 6);
  ctx.fillStyle = feature === 'door' ? '#80654f' : '#465e60';
  ctx.fillRect(left, top, width, height);
  const glass = ctx.createLinearGradient(left, top, left, top + height);
  glass.addColorStop(0, style.glass);
  glass.addColorStop(1, '#4b5e60');
  ctx.fillStyle = glass;
  if (feature === 'door') {
    ctx.fillRect(left + 7, top + 8, width - 14, height * 0.4);
    ctx.fillStyle = '#dfc898';
    ctx.fillRect(left + width - 9, top + height * 0.58, 4, 4);
  } else {
    ctx.fillRect(left + 2, top + 2, width - 4, height - 4);
    ctx.fillStyle = style.trim;
    for (let pane = 1; pane < panes; pane++) ctx.fillRect(left + width * pane / panes, top, 3, height);
  }
  if (feature === 'balcony') {
    ctx.fillStyle = style.trim;
    ctx.fillRect(left - 6, top + height - 18, width + 12, 3);
    for (let rail = 0; rail <= width; rail += 9) ctx.fillRect(left + rail, top + height - 16, 2, 16);
    ctx.fillRect(left - 7, top + height + 1, width + 14, 6);
  } else if (feature === 'display') {
    ctx.fillStyle = '#a88164';
    ctx.fillRect(left - 4, top - 9, width + 8, 6);
  }
}

export function makeLowRiseFacade(kind: LowRiseKind, style: NeighborhoodPalette) {
  const preset = lowRisePresets[kind];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4 * tile;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 3; row++) {
    const y = row * tile;
    ctx.fillStyle = '#382b2319';
    ctx.fillRect(0, y + tile - 5, canvas.width, 5);
    for (let bay = 0; bay < 4; bay++) {
      const x = bay * tile;
      if (row === 2 && kind === 'shop') drawOpening(ctx, x, y, style, [100, 80, 3], 'display');
      else if (row === 2 && kind === 'detached' && bay === 0) drawOpening(ctx, x, y, style, [43, 93, 1], 'door');
      else drawOpening(ctx, x, y, style, row === 0 ? preset.upper[bay] : preset.ground,
        kind === 'villa' && row === 0 && (bay === 1 || bay === 3) ? 'balcony' : 'window');
    }
  }
  const map = new T.CanvasTexture(canvas);
  map.wrapS = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return withFacadeDistance(new T.MeshStandardMaterial({ map, roughness: 0.88 }), style.wall, [110, 360], {
    uv: `
      #ifdef USE_MAP
        bool front = vMapUv.x <= -1.0;
        bool blank = !front && vMapUv.x < 0.0;
        bool ground = vMapUv.y < 1.0;
        float floorV = ground ? clamp( vMapUv.y, 0.0, 1.0 ) : fract( vMapUv.y );
        float row = blank ? 0.0 : ground ? ( front ? 1.0 : 2.0 ) : 3.0;
        vec2 facadeUv = vec2( front ? -vMapUv.x - 1.0 : vMapUv.x, ( row + mix( 0.016, 0.984, floorV ) ) * 0.25 );
      #endif
    `,
    sample: 'textureGrad( map, facadeUv, dFdx(vMapUv) * vec2(1.0, 0.242), dFdy(vMapUv) * vec2(1.0, 0.242) )',
  });
}

export function makeDetachedRoof(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 4; row++) {
    ctx.fillStyle = '#3e302633';
    ctx.fillRect(0, row * 16 + 14, 64, 2);
    for (let column = row % 2 ? 8 : 0; column < 64; column += 16) ctx.fillRect(column, row * 16, 2, 14);
  }
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  return new T.MeshStandardMaterial({ map, roughness: 0.96 });
}
