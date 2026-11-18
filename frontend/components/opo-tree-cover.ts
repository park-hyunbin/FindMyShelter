import * as T from 'three';
import type { Point } from './opo-data';

export type TreeCoverGrid = {
  source: string;
  catalog: string;
  license: string;
  year: number;
  originEPSG5186: number[];
  extentM: number;
  cellM: number;
  size: number;
  treeCells: number;
  mask: string;
};

export function readTreeCover(grid: TreeCoverGrid) {
  const { size, cellM, extentM } = grid;
  const mask = Uint8Array.from(atob(grid.mask), character => character.charCodeAt(0));
  if (mask.length !== Math.ceil(size ** 2 / 8) || size * cellM !== 2 * extentM) {
    throw new Error('수목 피복 자료의 격자 크기가 일치하지 않아요.');
  }
  const isTree = (index: number) => Boolean(mask[index >> 3] & (1 << (index % 8)));

  return {
    placements(random: () => number, excluded: (point: Point) => boolean) {
      const trees: Point[] = [];
      for (let index = 0; index < size ** 2; index++) {
        if (!isTree(index)) continue;
        const x = (index % size + 0.5) * cellM - extentM;
        const z = (Math.floor(index / size) + 0.5) * cellM - extentM;
        const nearby = x * x + z * z < 430 ** 2;
        if (random() > (nearby ? 0.67 : 0.19)) continue;
        const point = { x: x + (random() - 0.5) * cellM * 0.84, z: z + (random() - 0.5) * cellM * 0.84 };
        if (!excluded(point)) trees.push(point);
      }
      return trees;
    },

    overlay(geometry: T.BufferGeometry) {
      const pixels = new Uint8Array(size ** 2 * 4);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          if (!isTree(row * size + column)) continue;
          // PlaneGeometry uses v=1 at the north edge. Raster rows are stored north first.
          const offset = ((size - 1 - row) * size + column) * 4;
          pixels.set([166, 233, 92, 220], offset);
        }
      }
      const map = new T.DataTexture(pixels, size, size);
      map.colorSpace = T.SRGBColorSpace;
      map.needsUpdate = true;
      const material = new T.MeshBasicMaterial({
        map, transparent: true, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new T.Mesh(geometry, material);
      mesh.name = `수목 피복 · ${grid.year} · ${cellM}m`;
      mesh.visible = false;
      return mesh;
    },
  };
}

export type TreeCover = ReturnType<typeof readTreeCover>;
