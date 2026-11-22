import * as T from 'three';
import { buildingProfiles, type BuildingUse } from './data/building-profile';
import { inShape, type Point } from './opo-data';

const bay = 128;
const variants = 4;
// Representative Korean apartment glazing. References: Lotte Castle Clasia
// plans and construction photos, and LX Z:IN balcony sliding/split windows.
const apartmentWindows = [
  { left: 9, top: 14, width: 110, height: 91, panes: [.25, .75], transom: .68 },
  { left: 25, top: 24, width: 83, height: 71, panes: [.48] },
  { left: 22, top: 39, width: 49, height: 43, panes: [.52], louver: true },
  { left: 16, top: 19, width: 92, height: 82, panes: [.37, .75] },
] as const;
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

function paintApartmentBay(ctx: CanvasRenderingContext2D, x: number, style: NeighborhoodPalette, index: number) {
  const opening = apartmentWindows[index];
  const { top, width, height, panes } = opening;
  const left = x + opening.left;
  const glassInset = 3.5;
  const bottom = top + height;
  ctx.fillStyle = index === 2 ? style.accent ?? style.wall : style.wall;
  ctx.fillRect(x, 0, bay, bay);
  ctx.fillStyle = 'rgba(46,48,43,.13)';
  ctx.fillRect(x, 0, bay, 3);
  ctx.fillRect(left - 3, top - 2, width + 6, height + 7);
  ctx.fillStyle = '#deded5';
  ctx.fillRect(left, top, width, height);
  const reflection = ctx.createLinearGradient(left, top, left, bottom);
  reflection.addColorStop(0, style.glass);
  reflection.addColorStop(.58, '#52646a');
  reflection.addColorStop(1, '#76888d');
  ctx.fillStyle = reflection;
  ctx.fillRect(left + glassInset, top + glassInset, width - glassInset * 2, height - glassInset * 2);
  // Unequal fixed and moving sashes, with a visible overlapping meeting stile.
  ctx.fillStyle = '#cfd3cf';
  for (const pane of panes) ctx.fillRect(left + width * pane - 1, top, 2.5, height);
  if ('transom' in opening) {
    const rail = top + opening.transom * height;
    ctx.fillRect(left, rail, width, 3);
    ctx.fillStyle = 'rgba(221,228,226,.34)';
    ctx.fillRect(left + 4, rail + 3, width - 8, bottom - rail - 8);
  }
  ctx.fillStyle = '#e7e5dc';
  ctx.fillRect(left - 2, bottom, width + 4, 3);
  if ('louver' in opening) {
    ctx.fillStyle = '#9da39d';
    ctx.fillRect(x + 82, 46, 26, 38);
    ctx.fillStyle = '#c5c9c3';
    for (let slat = 49; slat < 82; slat += 4) ctx.fillRect(x + 84, slat, 22, 1);
  }
}

export function withFacadeDistance(material: T.MeshStandardMaterial, wall: string, range: [number, number], atlas?: {
  uv: string;
  sample: string;
}) {
  material.customProgramCacheKey = () => atlas?.uv ?? 'facade-distance';
  material.onBeforeCompile = shader => {
    shader.uniforms.facadePlain = { value: new T.Color(wall) };
    shader.uniforms.facadeRange = { value: new T.Vector2(...range) };
    const map = T.ShaderChunk.map_fragment
      .replace('texture2D( map, vMapUv )', atlas?.sample ?? 'texture2D( map, vMapUv )')
      .replace('diffuseColor *= sampledDiffuseColor;', `
        float detail = 1.0 - smoothstep( facadeRange.x, facadeRange.y, length( vViewPosition ) );
        diffuseColor.rgb *= mix( facadePlain, sampledDiffuseColor.rgb, detail );
      `);
    shader.fragmentShader = `uniform vec3 facadePlain; uniform vec2 facadeRange;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `${atlas?.uv ?? ''}\n${map}`);
  };
  return material;
}

export function neighborhoodFacade(use: BuildingUse, style: NeighborhoodPalette = buildingProfiles[use]) {
  const canvas = document.createElement('canvas');
  canvas.width = variants * bay;
  canvas.height = 3 * bay;
  const ctx = canvas.getContext('2d')!;
  const tinted = (color: string, scale: number) => new T.Color(color).multiplyScalar(scale).getStyle();

  for (const [row, pattern] of [openings[use].upper, openings[use].ground].entries()) {
    const lower = row === 1;
    for (let variant = 0; variant < variants; variant++) {
      const x = variant * bay, y = row * bay;
      if (use === 'apartments' && !lower) {
        paintApartmentBay(ctx, x, style, variant);
        continue;
      }
      const [openingWidth, openingHeight, panes] = pattern;
      ctx.fillStyle = tinted(style.wall, (lower ? 0.78 : 1) * (1 - 0.034 * variant));
      ctx.fillRect(x, y, bay, bay);
      ctx.fillStyle = 'rgba(35,40,39,.10)';
      for (const joint of [1, 42, 84]) ctx.fillRect(x, y + joint, bay, 1);
      ctx.fillStyle = tinted(style.trim, lower ? 0.93 : 1.12);
      ctx.fillRect(x, y + bay - (lower ? 12 : 4), bay, lower ? 12 : 4);

      const width = openingWidth - (variant === 2 && !lower ? 13 : 0);
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
  // Negative U selects the apartment end-wall row.
  return withFacadeDistance(new T.MeshStandardMaterial({ map, roughness: 0.86 }), style.wall, [260, 680], {
    uv: `
      #ifdef USE_MAP
        bool endWall = vMapUv.x < 0.0;
        bool groundFloor = vMapUv.y < 1.0;
        float floorV = groundFloor ? clamp(vMapUv.y, 0.0, 1.0) : fract(vMapUv.y);
        float atlasRow = endWall ? 0.0 : groundFloor ? 1.0 : 2.0;
        vec2 facadeUv = vec2(endWall ? -vMapUv.x - 1.0 : vMapUv.x, (atlasRow + mix(0.012, 0.988, floorV)) / 3.0);
        vec2 facadeScale = vec2(1.0, 0.976 / 3.0);
      #endif
    `,
    sample: 'textureGrad( map, facadeUv, dFdx(vMapUv) * facadeScale, dFdy(vMapUv) * facadeScale )',
  });
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

export function facadeUV(bayWidth: number, floorHeight: number, skirt: number, apartmentOutline?: Point[], lowRise?: {
  minWallM: number;
  front?: [Point, Point];
}): T.UVGenerator {
  return {
    generateTopUV(_geometry, positions, a, b, c) {
      return [a, b, c].map(vertex => new T.Vector2(positions[vertex * 3], positions[vertex * 3 + 1]));
    },
    generateSideWallUV(_geometry, positions, a, b, c, d) {
      const x = positions[a * 3], y = positions[a * 3 + 1];
      const bx = positions[b * 3], by = positions[b * 3 + 1];
      const length = Math.hypot(bx - x, by - y);
      const front = lowRise?.front;
      const facesStreet = front && ((front[0].x === x && front[0].z === -y && front[1].x === bx && front[1].z === -by)
        || (front[1].x === x && front[1].z === -y && front[0].x === bx && front[0].z === -by));
      // The wall's own length sets its bay spacing, including on diagonal footprint edges.
      const bays = Math.max(1, Math.round(length / bayWidth));
      const start = apartmentOutline ? (bays === 1 ? 1 : 0) : Math.abs(Math.round(x * 3 + y * 7)) % variants;
      const end = length >= 1.4 ? start + bays : start;
      const endWall = apartmentOutline && deepApartmentEnd(apartmentOutline, { x, z: -y }, { x: bx, z: -by }, length);
      return [a, b, c, d].map((vertex, index) => {
        const first = index === 0 || index === 3;
        const u = lowRise && length < lowRise.minWallM ? -0.5
          : facesStreet ? -1 - (first ? 0 : Math.min(variants, bays) / variants)
            : endWall ? (first ? -1 : -2) : (first ? start : end) / variants;
        return new T.Vector2(u, (positions[vertex * 3 + 2] - skirt) / floorHeight);
      });
    },
  };
}
