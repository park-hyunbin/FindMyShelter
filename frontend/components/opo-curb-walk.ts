import * as T from 'three';
import type { CrosswalkArea } from './opo-crosswalks';
import { inShape, nearestOnLine, type OpoData, type Point } from './opo-data';

export const sidewalkRise = 0.14;

export function sidewalkFascia(outline: Point[], ground: OpoData['ground'], top: OpoData['ground']) {
  const vertices: number[] = [];
  for (const [i, a] of outline.entries()) {
    const b = outline[(i + 1) % outline.length];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.65);
    for (let step = 0; step < steps; step++) {
      const point = (fraction: number) => {
        const x = T.MathUtils.lerp(a.x, b.x, fraction), z = T.MathUtils.lerp(a.z, b.z, fraction);
        return { foot: [x, ground(x, z) - 0.02, z], cap: [x, top(x, z), z] };
      };
      const from = point(step / steps), to = point((step + 1) / steps);
      vertices.push(...from.foot, ...to.foot, ...from.cap, ...from.cap, ...to.foot, ...to.cap);
    }
  }
  const mesh = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  mesh.computeVertexNormals();
  return mesh;
}

export function curbWalk(
  edge: Point[], width: number, outward: -1 | 1, ground: OpoData['ground'], road: OpoData['ground'],
  crossings: CrosswalkArea[], flushEndM = 0,
  join?: { outline: Point[]; grade: OpoData['ground'] },
) {
  const curbWidth = Math.min(0.16, width / 3);
  const sections: T.Vector3[][] = [];
  const joinBoundary = join && [...join.outline, join.outline[0]];
  const offsets = edge.slice(1).map((point, i) => {
    const dx = point.x - edge[i].x;
    const dz = point.z - edge[i].z;
    const length = Math.hypot(dx, dz);
    return { x: outward * dz / length, z: -outward * dx / length, length };
  });
  const corners = edge.map((_, i) => {
    const before = offsets[Math.max(0, i - 1)];
    const after = offsets[Math.min(offsets.length - 1, i)];
    // A shared miter keeps the curb and walk joined at bends. Bound it at acute corners.
    const miter = Math.max(0.55, 1 + before.x * after.x + before.z * after.z);
    return { x: (before.x + after.x) / miter, z: (before.z + after.z) / miter };
  });

  function section(x: number, z: number, nx: number, nz: number, remaining: number) {
    const groundAtEdge = ground(x, z);
    const roadAtEdge = road(x, z);
    let clearance = Infinity;
    for (const { center, direction, depth, section } of crossings) {
      const dx = x - center.x, dz = z - center.z;
      const along = Math.abs(dx * direction.x + dz * direction.z);
      const across = Math.abs(dx * direction.z - dz * direction.x);
      clearance = Math.min(clearance, Math.hypot(
        Math.max(0, along - depth / 2), Math.max(0, across - section.width / 2 - 1.1),
      ));
    }
    // Drop the curb to the paved deck at a crossing, with a grade transition on either side.
    const lift = T.MathUtils.lerp(0.014, sidewalkRise, T.MathUtils.smoothstep(clearance, 0.25, 1.65));
    const raised = flushEndM > 0 ? T.MathUtils.smoothstep(remaining, 0, flushEndM) : 1;
    function top(offset: number) {
      const px = x + nx * offset, pz = z + nz * offset;
      const y = roadAtEdge + lift + ground(px, pz) - groundAtEdge;
      const height = raised === 1 ? y : T.MathUtils.lerp(road(px, pz) + 0.008, y, raised);
      if (!join || !joinBoundary) return new T.Vector3(px, height, pz);
      const point = { x: px, z: pz };
      const distance = inShape(point, [join.outline]) ? 0 : nearestOnLine(point, [joinBoundary]).distance;
      const blend = T.MathUtils.smoothstep(distance, 0, 1.4);
      return new T.Vector3(px, T.MathUtils.lerp(join.grade(px, pz), height, blend), pz);
    }
    const outside = top(width);
    sections.push([
      new T.Vector3(x, roadAtEdge - 0.025, z), top(0), top(curbWidth), outside,
      new T.Vector3(outside.x, ground(outside.x, outside.z) - 0.025, outside.z),
    ]);
  }

  let remaining = offsets.reduce((distance, offset) => distance + offset.length, 0);
  for (const [i, { length }] of offsets.entries()) {
    const a = edge[i], b = edge[i + 1];
    const start = corners[i], end = corners[i + 1];
    const steps = Math.ceil(length / 0.55);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      section(T.MathUtils.lerp(a.x, b.x, t), T.MathUtils.lerp(a.z, b.z, t),
        T.MathUtils.lerp(start.x, end.x, t), T.MathUtils.lerp(start.z, end.z, t), remaining - length * t);
    }
    remaining -= length;
  }
  const end = edge[edge.length - 1], direction = corners[corners.length - 1];
  section(end.x, end.z, direction.x, direction.z, 0);

  const strips = (pairs: [number, number][], closeEnds = false) => {
    const positions: number[] = [];
    function quad(a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3) {
      for (const { x, y, z } of outward === 1 ? [a, b, c, c, b, d] : [a, c, b, c, d, b]) positions.push(x, y, z);
    }
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1], b = sections[i];
      for (const [j, k] of pairs) quad(a[j], b[j], a[k], b[k]);
    }
    if (closeEnds) for (const end of [sections[0], sections[sections.length - 1]]) {
      quad(end[0], end[4], end[1], end[3]);
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  };
  const centerline = sections.map(([, , inner, outer]) => ({
    x: (inner.x + outer.x) / 2, z: (inner.z + outer.z) / 2,
  }));
  return { top: strips([[2, 3]]), curb: strips([[1, 2]]), curbFace: strips([[0, 1]]),
    fascia: strips([[3, 4]], true), centerline };
}
