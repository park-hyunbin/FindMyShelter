import * as T from 'three';
import type { Point } from './opo-data';

type Vertex = Point & { y: number };
type Triangle = [Vertex, Vertex, Vertex];
type Bounds = { west: number; east: number; north: number; south: number };
type SurfaceTriangle = { points: Triangle; bounds: Bounds; area: number };

const epsilon = 1e-6;
const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);

function boundsOf([a, b, c]: Triangle): Bounds {
  return {
    west: Math.min(a.x, b.x, c.x), east: Math.max(a.x, b.x, c.x),
    north: Math.min(a.z, b.z, c.z), south: Math.max(a.z, b.z, c.z),
  };
}

function forTriangles(geometry: T.BufferGeometry, visit: (triangle: Triangle) => void) {
  const points = geometry.getAttribute('position');
  if (!points?.count) return;
  const index = geometry.getIndex();
  for (let i = 0; i + 2 < (index?.count ?? points.count); i += 3) {
    const at = (offset: number): Vertex => {
      const j = index?.getX(i + offset) ?? i + offset;
      return { x: points.getX(j), y: points.getY(j), z: points.getZ(j) };
    };
    visit([at(0), at(1), at(2)]);
  }
}

function clipEdge(polygon: Point[], a: Point, b: Point) {
  const out: Point[] = [];
  let previous = polygon[polygon.length - 1];
  let behind = side(a, b, previous);
  for (const point of polygon) {
    const ahead = side(a, b, point);
    if ((ahead >= 0) !== (behind >= 0)) {
      const t = behind / (behind - ahead);
      out.push({ x: T.MathUtils.lerp(previous.x, point.x, t), z: T.MathUtils.lerp(previous.z, point.z, t) });
    }
    if (ahead >= 0) out.push(point);
    previous = point;
    behind = ahead;
  }
  return out;
}

function fits(a: Bounds, b: Bounds) {
  return a.east >= b.west && a.west <= b.east && a.south >= b.north && a.north <= b.south;
}

function polygonArea(polygon: Point[]) {
  let doubled = 0;
  for (let i = 2; i < polygon.length; i++) doubled += side(polygon[0], polygon[i - 1], polygon[i]);
  return Math.abs(doubled);
}

function surfaceHeight([a, b, c]: Triangle, area: number, point: Point) {
  return (a.y * side(b, c, point) + b.y * side(c, a, point) + c.y * side(a, b, point)) / area;
}

export function createSurfaceClipper(cellSize = 10) {
  const cells = new Map<string, SurfaceTriangle[]>();

  function eachCell(bounds: Bounds, visit: (key: string) => void) {
    const west = Math.floor(bounds.west / cellSize), east = Math.floor(bounds.east / cellSize);
    const north = Math.floor(bounds.north / cellSize), south = Math.floor(bounds.south / cellSize);
    for (let x = west; x <= east; x++) for (let z = north; z <= south; z++) visit(`${x}:${z}`);
  }

  function addSurface(geometry: T.BufferGeometry) {
    forTriangles(geometry, points => {
      const [a, b, c] = points;
      const area = side(a, b, c);
      if (Math.abs(area) < epsilon) return;
      const surface: SurfaceTriangle = { points: area > 0 ? points : [a, c, b], bounds: boundsOf(points), area: Math.abs(area) };
      eachCell(surface.bounds, key => {
        const group = cells.get(key);
        if (group) group.push(surface);
        else cells.set(key, [surface]);
      });
    });
  }

  function nearbySurfaces(bounds: Bounds) {
    const nearby = new Set<SurfaceTriangle>();
    eachCell(bounds, key => cells.get(key)?.forEach(surface => {
      if (fits(bounds, surface.bounds)) nearby.add(surface);
    }));
    return nearby;
  }

  function trianglesOnSurface(vertices: number[], polygon: Point[], surface: Triangle, area: number, lift = 0) {
    for (let i = 1; i + 1 < polygon.length; i++) {
      const triangle = [polygon[0], polygon[i], polygon[i + 1]];
      if (Math.abs(side(triangle[0], triangle[1], triangle[2])) < epsilon) continue;
      for (const point of triangle) {
        const y = surfaceHeight(surface, area, point);
        vertices.push(point.x, y + lift, point.z);
      }
    }
  }

  function toGeometry(vertices: number[]) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  function clip(mask: T.BufferGeometry, lift: number) {
    const vertices: number[] = [];
    forTriangles(mask, triangle => {
      const bounds = boundsOf(triangle);
      for (const { points, area } of nearbySurfaces(bounds)) {
        const [a, b, c] = points;
        let polygon: Point[] = triangle;
        for (const [start, end] of [[a, b], [b, c], [c, a]]) {
          polygon = clipEdge(polygon, start, end);
          if (polygon.length < 3) break;
        }
        trianglesOnSurface(vertices, polygon, points, area, lift);
      }
    });
    return toGeometry(vertices);
  }

  function subtract(mask: T.BufferGeometry, maxVerticalGap?: number) {
    const vertices: number[] = [];
    forTriangles(mask, triangle => {
      const area = side(triangle[0], triangle[1], triangle[2]);
      if (Math.abs(area) < epsilon) return;
      let outside: Point[][] = [triangle];
      for (const cutter of nearbySurfaces(boundsOf(triangle))) {
        const [a, b, c] = cutter.points;
        outside = outside.flatMap(polygon => {
          // A convex cutter partitions its subject into an inner polygon and at most three outer pieces.
          const ab = clipEdge(polygon, a, b);
          if (ab.length < 3) return [polygon];
          const bc = clipEdge(ab, b, c);
          if (bc.length < 3) return [polygon];
          const inside = clipEdge(bc, c, a);
          if (polygonArea(inside) < epsilon) return [polygon];
          if (maxVerticalGap !== undefined && inside.some(point =>
            Math.abs(surfaceHeight(triangle, area, point) - surfaceHeight(cutter.points, cutter.area, point)) > maxVerticalGap)) return [polygon];
          return [clipEdge(polygon, b, a), clipEdge(ab, c, b), clipEdge(bc, a, c)]
            .filter(piece => polygonArea(piece) >= epsilon);
        });
        if (!outside.length) break;
      }
      for (const polygon of outside) trianglesOnSurface(vertices, polygon, triangle, area);
    });
    return toGeometry(vertices);
  }

  function heightAt(point: Point) {
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.z / cellSize)}`;
    let height: number | undefined;
    for (const { points: [a, b, c], bounds, area } of cells.get(key) ?? []) {
      if (point.x < bounds.west || point.x > bounds.east || point.z < bounds.north || point.z > bounds.south) continue;
      const wa = side(b, c, point), wb = side(c, a, point), wc = side(a, b, point);
      if (Math.min(wa, wb, wc) < -epsilon) continue;
      const y = (a.y * wa + b.y * wb + c.y * wc) / area;
      height = Math.max(height ?? y, y);
    }
    return height;
  }
  return { addSurface, clip, subtract, heightAt, clear: () => cells.clear() };
}
