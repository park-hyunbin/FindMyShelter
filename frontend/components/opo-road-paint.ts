import * as T from 'three';
import type { Point } from './opo-data';

type Vertex = Point & { y: number };
type Triangle = [Vertex, Vertex, Vertex];
type Bounds = { west: number; east: number; north: number; south: number };
type Deck = { points: Triangle; bounds: Bounds; area: number };

const cellSize = 10;
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

export function createRoadPaintClipper() {
  const cells = new Map<string, Deck[]>();

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
      const deck: Deck = { points: area > 0 ? points : [a, c, b], bounds: boundsOf(points), area: Math.abs(area) };
      eachCell(deck.bounds, key => {
        const group = cells.get(key);
        if (group) group.push(deck);
        else cells.set(key, [deck]);
      });
    });
  }

  function clip(marking: T.BufferGeometry, lift: number) {
    const vertices: number[] = [];
    forTriangles(marking, triangle => {
      const bounds = boundsOf(triangle);
      const nearby = new Set<Deck>();
      eachCell(bounds, key => cells.get(key)?.forEach(deck => nearby.add(deck)));
      for (const { points: [a, b, c], bounds: deck, area } of nearby) {
        if (bounds.east < deck.west || bounds.west > deck.east || bounds.south < deck.north || bounds.north > deck.south) continue;
        let polygon: Point[] = triangle;
        for (const [start, end] of [[a, b], [b, c], [c, a]]) {
          polygon = clipEdge(polygon, start, end);
          if (polygon.length < 3) break;
        }
        for (let i = 1; i + 1 < polygon.length; i++) {
          const triangle = [polygon[0], polygon[i], polygon[i + 1]];
          if (Math.abs(side(triangle[0], triangle[1], triangle[2])) < epsilon) continue;
          for (const point of triangle) {
            const y = (a.y * side(b, c, point) + b.y * side(c, a, point) + c.y * side(a, b, point)) / area;
            vertices.push(point.x, y + lift, point.z);
          }
        }
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
  return { addSurface, clip, clear: () => cells.clear() };
}
