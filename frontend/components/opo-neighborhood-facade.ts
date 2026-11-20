import * as T from 'three';
import { buildingProfiles, type BuildingUse } from './data/building-profile';
import { inShape, type Point } from './opo-data';

const bay = 128;
const variants = 4;
const apartmentWindows = [[98, 68, 3], [88, 62, 2], [46, 42, 1], [67, 54, 2]] as const;
const openings = {
  house:       { upper: [70, 57, 2], ground: [35, 89, 1] },
  apartments:  { upper: [98, 70, 3], ground: [58, 83, 2] },
  commercial: { upper: [99, 77, 2], ground: [109, 91, 3] },
  civic:       { upper: [99, 54, 3], ground: [72, 80, 2] },
  industrial:  { upper: [79, 29, 2], ground: [91, 86, 1] },
  utility:     { upper: [40, 28, 1], ground: [44, 74, 1] },
  unknown:     { upper: [63, 54, 2], ground: [36, 69, 1] },
} as const;

export type NeighborhoodPalette = { wall: string; glass: string; trim: string; roof: string; accent?: string };

export function neighborhoodFacade(use: BuildingUse, style: NeighborhoodPalette = buildingProfiles[use]) {
  const canvas = document.createElement('canvas');
  canvas.width = variants * bay;
  canvas.height = 3 * bay;
  const ctx = canvas.getContext('2d')!;
  const tinted = (color: string, scale: number) => new T.Color(color).multiplyScalar(scale).getStyle();

  for (const [row, pattern] of [openings[use].upper, openings[use].ground].entries()) {
    const lower = row === 1;
    for (let variant = 0; variant < variants; variant++) {
      const apartmentUpper = use === 'apartments' && !lower;
      const [openingWidth, openingHeight, panes] = apartmentUpper ? apartmentWindows[variant] : pattern;
      const x = variant * bay, y = row * bay;
      const wall = apartmentUpper && variant === 2 ? style.accent ?? style.wall : style.wall;
      ctx.fillStyle = tinted(wall, (lower ? 0.78 : 1) * (1 - 0.034 * variant));
      ctx.fillRect(x, y, bay, bay);
      ctx.fillStyle = 'rgba(35,40,39,.10)';
      if (apartmentUpper) {
        ctx.fillRect(x, y, bay, 2);
        ctx.fillRect(x + bay - (variant === 2 ? 7 : 4), y, variant === 2 ? 7 : 4, bay);
      } else {
        for (const joint of [1, 42, 84]) ctx.fillRect(x, y + joint, bay, 1);
      }
      ctx.fillStyle = tinted(style.trim, lower ? 0.93 : 1.12);
      ctx.fillRect(x, y + bay - (lower ? 12 : 4), bay, lower ? 12 : 4);

      const width = openingWidth - (!apartmentUpper && variant === 2 && !lower ? 13 : 0);
      const left = x + (bay - width) / 2 + (variant === 2 ? 3 : 0);
      const top = lower ? y + bay - openingHeight - 9 : y + (bay - openingHeight) / 2 - 4;
      ctx.fillStyle = tinted(style.trim, 0.73);
      ctx.fillRect(left - 3, top - 2, width + 6, openingHeight + 6);
      ctx.fillStyle = '#394747';
      ctx.fillRect(left, top, width, openingHeight);
      const reflection = ctx.createLinearGradient(left, top, left, top + openingHeight);
      reflection.addColorStop(0, tinted(style.glass, variant === 1 ? 1.58 : 1.33));
      reflection.addColorStop(0.34, tinted(style.glass, variant === 3 ? 1.04 : 0.88));
      reflection.addColorStop(1, tinted(style.glass, 0.48));
      ctx.fillStyle = reflection;
      ctx.fillRect(left + 2, top + 3, width - 4, openingHeight - 5);
      ctx.fillStyle = tinted(style.trim, 1.22);
      for (let pane = 1; pane < panes; pane++) {
        ctx.fillRect(left + width * pane / panes, top + 2, 2, openingHeight - 3);
      }
      ctx.fillRect(left - 2, top + openingHeight, width + 4, 3);
      if (apartmentUpper && variant < 2) {
        ctx.fillStyle = tinted(style.trim, 0.92);
        ctx.fillRect(left - 3, top + openingHeight - 12, width + 6, 2);
        for (let rail = 5; rail < width; rail += 8) ctx.fillRect(left + rail, top + openingHeight - 10, 1.4, 10);
      }
    }
  }

  // The bottom atlas row spans one full apartment end wall.
  const endWallY = 2 * bay;
  ctx.fillStyle = style.wall;
  ctx.fillRect(0, endWallY, canvas.width, bay);
  ctx.fillStyle = tinted(style.trim, 1.13);
  ctx.fillRect(0, endWallY, canvas.width * 0.14, bay);
  ctx.fillRect(canvas.width * 0.86, endWallY, canvas.width * 0.14, bay);
  ctx.fillStyle = tinted(style.accent ?? style.trim, 1.18);
  ctx.fillRect(canvas.width * 0.19, endWallY, canvas.width * 0.045, bay);
  ctx.fillRect(canvas.width * 0.766, endWallY, canvas.width * 0.045, bay);
  ctx.fillStyle = 'rgba(45,53,49,.08)';
  ctx.fillRect(0, endWallY + bay - 2, canvas.width, 2);

  const map = new T.CanvasTexture(canvas);
  map.wrapS = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new T.MeshStandardMaterial({ map, roughness: 0.86 });
  material.onBeforeCompile = shader => {
    // Negative U selects the end-wall row while keeping both wall corners within one tile.
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        bool endWall = vMapUv.x < 0.0;
        bool groundFloor = vMapUv.y < 1.0;
        float floorV = groundFloor ? clamp(vMapUv.y, 0.0, 1.0) : fract(vMapUv.y);
        float atlasRow = endWall ? 0.0 : groundFloor ? 1.0 : 2.0;
        vec2 facadeUv = vec2(endWall ? -vMapUv.x - 1.0 : vMapUv.x, (atlasRow + mix(0.012, 0.988, floorV)) / 3.0);
        vec2 facadeScale = vec2(1.0, 0.976 / 3.0);
      #endif
      ${T.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )',
      'textureGrad( map, facadeUv, dFdx(vMapUv) * facadeScale, dFdy(vMapUv) * facadeScale )')}
    `);
  };
  return material;
}

function deepApartmentEnd(outline: Point[], start: Point, end: Point, length: number) {
  if (length < 5.5 || length > 24) return false;
  const dx = end.x - start.x, dz = end.z - start.z;
  const normal = { x: -dz / length, z: dx / length };
  const rings = [outline];
  const at = (fraction: number, offset: number) => ({
    x: start.x + dx * fraction + normal.x * offset,
    z: start.z + dz * fraction + normal.z * offset,
  });
  const inward = inShape(at(0.5, 0.15), rings) ? 1 : -1;
  const depth = inward * Math.max(18, length * 1.55);
  return [0.25, 0.5, 0.75].every(fraction =>
    inShape(at(fraction, depth * 0.5), rings) && inShape(at(fraction, depth), rings));
}

export function facadeUV(bayWidth: number, floorHeight: number, skirt: number, apartmentOutline?: Point[]): T.UVGenerator {
  return {
    generateTopUV(_geometry, positions, a, b, c) {
      return [a, b, c].map(vertex => new T.Vector2(positions[vertex * 3], positions[vertex * 3 + 1]));
    },
    generateSideWallUV(_geometry, positions, a, b, c, d) {
      const x = positions[a * 3], y = positions[a * 3 + 1];
      const bx = positions[b * 3], by = positions[b * 3 + 1];
      const length = Math.hypot(bx - x, by - y);
      const start = Math.abs(Math.round(x * 3 + y * 7)) % variants;
      // The wall's own length sets its bay spacing, including on diagonal footprint edges.
      const bays = Math.max(1, Math.round(length / bayWidth));
      const end = length >= 1.4 ? start + bays : start;
      const endWall = apartmentOutline && deepApartmentEnd(apartmentOutline, { x, z: -y }, { x: bx, z: -by }, length);
      return [a, b, c, d].map((vertex, index) => {
        const first = index === 0 || index === 3;
        const u = endWall ? (first ? -1 : -2) : (first ? start : end) / variants;
        return new T.Vector2(u, (positions[vertex * 3 + 2] - skirt) / floorHeight);
      });
    },
  };
}
