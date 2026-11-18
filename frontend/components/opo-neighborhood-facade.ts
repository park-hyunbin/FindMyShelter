import * as T from 'three';
import { buildingProfiles, type BuildingUse } from './data/building-profile';

const bay = 128;
const variants = 4;
const openings = {
  house:       { upper: [70, 57, 2], ground: [35, 89, 1] },
  apartments:  { upper: [98, 70, 3], ground: [58, 83, 2] },
  commercial: { upper: [99, 77, 2], ground: [109, 91, 3] },
  civic:       { upper: [99, 54, 3], ground: [72, 80, 2] },
  industrial:  { upper: [79, 29, 2], ground: [91, 86, 1] },
  utility:     { upper: [40, 28, 1], ground: [44, 74, 1] },
  unknown:     { upper: [63, 54, 2], ground: [36, 69, 1] },
} as const;

export function neighborhoodFacade(use: BuildingUse) {
  const style = buildingProfiles[use];
  const canvas = document.createElement('canvas');
  canvas.width = variants * bay;
  canvas.height = 2 * bay;
  const ctx = canvas.getContext('2d')!;
  const tinted = (color: string, scale: number) => new T.Color(color).multiplyScalar(scale).getStyle();

  for (const [row, pattern] of [openings[use].upper, openings[use].ground].entries()) {
    const lower = row === 1;
    const [openingWidth, openingHeight, panes] = pattern;
    for (let variant = 0; variant < variants; variant++) {
      const x = variant * bay, y = row * bay;
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
      if (use === 'apartments' && !lower) {
        ctx.fillStyle = tinted(style.trim, 0.92);
        ctx.fillRect(left - 3, top + openingHeight - 12, width + 6, 2);
        for (let rail = 5; rail < width; rail += 8) ctx.fillRect(left + rail, top + openingHeight - 10, 1.4, 10);
      }
    }
  }

  const map = new T.CanvasTexture(canvas);
  map.wrapS = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new T.MeshStandardMaterial({ map, roughness: 0.86 });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', T.ShaderChunk.map_fragment.replace(
      'texture2D( map, vMapUv )',
      `textureGrad( map,
        vec2( vMapUv.x, ( vMapUv.y < 1.0 ? 0.0 : 0.5 ) + mix( 0.006, 0.494,
          vMapUv.y < 1.0 ? clamp( vMapUv.y, 0.0, 1.0 ) : fract( vMapUv.y ) ) ),
        dFdx( vMapUv ) * vec2( 1.0, 0.488 ), dFdy( vMapUv ) * vec2( 1.0, 0.488 ) )`,
    ));
  };
  return material;
}

export function facadeUV(bayWidth: number, floorHeight: number, skirt: number): T.UVGenerator {
  return {
    generateTopUV(_geometry, positions, a, b, c) {
      return [a, b, c].map(vertex => new T.Vector2(positions[vertex * 3], positions[vertex * 3 + 1]));
    },
    generateSideWallUV(_geometry, positions, a, b, c, d) {
      const x = positions[a * 3], y = positions[a * 3 + 1];
      const length = Math.hypot(positions[b * 3] - x, positions[b * 3 + 1] - y);
      const start = Math.abs(Math.round(x * 3 + y * 7)) % variants;
      // The wall's own length sets its bay spacing, including on diagonal footprint edges.
      const bays = Math.max(1, Math.round(length / bayWidth));
      const end = length >= 1.4 ? start + bays : start;
      return [a, b, c, d].map((vertex, index) => new T.Vector2(
        (index === 0 || index === 3 ? start : end) / variants,
        (positions[vertex * 3 + 2] - skirt) / floorHeight,
      ));
    },
  };
}
