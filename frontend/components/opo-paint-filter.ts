import * as T from 'three';

export function attachPaintFilter(geometry: T.BufferGeometry, material: T.MeshStandardMaterial,
  viewport: { value: T.Vector2 }, projection: { value: number }) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('paintCoordinates');
  const across = new T.BufferAttribute(new Float32Array(position.count * 3), 3);
  const along = new T.BufferAttribute(new Float32Array(position.count * 3), 3);
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const u = new T.Vector3(), v = new T.Vector3();
  for (let i = 0; i + 2 < position.count; i += 3) {
    const u1 = uv.getX(i + 1) - uv.getX(i), v1 = uv.getY(i + 1) - uv.getY(i);
    const u2 = uv.getX(i + 2) - uv.getX(i), v2 = uv.getY(i + 2) - uv.getY(i);
    const det = u1 * v2 - u2 * v1;
    if (Math.abs(det) < 1e-10) continue;
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1).sub(a);
    c.fromBufferAttribute(position, i + 2).sub(a);
    // World-space derivatives of this projected triangle along its paint axes.
    u.copy(b).multiplyScalar(v2 / det).addScaledVector(c, -v1 / det);
    v.copy(c).multiplyScalar(u1 / det).addScaledVector(b, -u2 / det);
    for (let j = i; j < i + 3; j++) {
      across.setXYZ(j, u.x, u.y, u.z);
      along.setXYZ(j, v.x, v.y, v.z);
    }
  }
  geometry.setAttribute('paintAcross', across);
  geometry.setAttribute('paintAlong', along);
  material.onBeforeCompile = shader => {
    shader.uniforms.paintViewport = viewport;
    shader.uniforms.paintProjection = projection;
    shader.vertexShader = `
      attribute vec2 paintCoordinates;
      attribute vec3 paintAcross, paintAlong;
      attribute float paintWidth;
      uniform vec2 paintViewport;
      varying vec2 vPaintCoordinates;
      varying float vPaintFiltered, vPaintWidth;
    ` + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vPaintCoordinates = paintCoordinates;
      vPaintFiltered = 0.0;
      vPaintWidth = paintWidth;
      if (gl_Position.w > 0.25) {
        vec4 acrossClip = projectionMatrix * modelViewMatrix * vec4(paintAcross, 0.0);
        vec4 alongClip = projectionMatrix * modelViewMatrix * vec4(paintAlong, 0.0);
        // Measure the subpixel decision at the stroke centre, away from
        // changes in coverage at its tessellated edges.
        vec4 reference = gl_Position - acrossClip * paintCoordinates.x - alongClip * (paintCoordinates.y - 0.5);
        if (reference.w > 35.0) {
          vec2 referenceScale = paintViewport / (2.0 * reference.w);
          vec2 refU = (acrossClip.xy - reference.xy * (acrossClip.w / reference.w)) * referenceScale;
          vec2 refV = (alongClip.xy - reference.xy * (alongClip.w / reference.w)) * referenceScale;
          float projectedArea = abs(refU.x * refV.y - refU.y * refV.x);
          float span = projectedArea / max(max(length(refU), length(refV)), 0.00001);
          vec2 scale = paintViewport / (2.0 * gl_Position.w);
          vec2 du = (acrossClip.xy - gl_Position.xy * (acrossClip.w / gl_Position.w)) * scale;
          vec2 dv = (alongClip.xy - gl_Position.xy * (alongClip.w / gl_Position.w)) * scale;
          float det = du.x * dv.y - du.y * dv.x;
          if (span < 1.5 && abs(det) > 0.0001) {
            vPaintFiltered = 1.0;
            vec2 footprint = vec2(abs(dv.x) + abs(dv.y), abs(du.x) + abs(du.y)) / abs(det);
            vec2 sides = vec2(step(0.499, abs(paintCoordinates.x)) * sign(paintCoordinates.x),
              step(0.499, abs(paintCoordinates.y - 0.5)) * sign(paintCoordinates.y - 0.5));
            // Draw a small border at the stroke's real edges so a pixel can
            // receive coverage even with its centre outside the stripe.
            vec2 apron = 0.75 * footprint * sides;
            vec2 pixelOffset = du * apron.x + dv * apron.y;
            float factor = min(1.0, 2.0 / max(length(pixelOffset), 0.00001));
            gl_Position.xy += pixelOffset * (2.0 * gl_Position.w * factor / paintViewport);
            vPaintCoordinates += apron * factor;
          }
        }
      }
    `);
    shader.fragmentShader = `
      varying vec2 vPaintCoordinates;
      varying float vPaintFiltered, vPaintWidth;
      uniform float paintProjection;
      float paintCross(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

      float paintCoverage(vec2 uv, vec2 dx, vec2 dy) {
        vec2 halfPixel = (abs(dx) + abs(dy)) * 0.5;
        if (all(lessThanEqual(abs(uv) + halfPixel, vec2(0.5)))) return 1.0;
        if (any(greaterThan(abs(uv) - halfPixel, vec2(0.5)))) return 0.0;
        float pixelArea = abs(paintCross(dx, dy));
        if (pixelArea < 0.00000000001) return step(abs(uv.x), 0.5) * step(abs(uv.y), 0.5);

        // The pixel projects to a parallelogram in the stroke's coordinates.
        // Clip it to the paint rectangle and use the covered fraction as alpha.
        vec2 polygon[8], work[8];
        polygon[0] = uv - (dx + dy) * 0.5;
        polygon[1] = uv + (dx - dy) * 0.5;
        polygon[2] = uv + (dx + dy) * 0.5;
        polygon[3] = uv - (dx - dy) * 0.5;
        int count = 4;
        for (int edge = 0; edge < 4; edge++) {
          vec2 normal = edge < 2 ? vec2(edge == 0 ? 1.0 : -1.0, 0.0)
            : vec2(0.0, edge == 2 ? 1.0 : -1.0);
          vec2 previous = polygon[count - 1];
          float previousGap = 0.5 - dot(previous, normal);
          int next = 0;
          for (int i = 0; i < 8; i++) {
            if (i >= count) break;
            vec2 current = polygon[i];
            float gap = 0.5 - dot(current, normal);
            if ((gap < 0.0 && previousGap > 0.0) || (gap > 0.0 && previousGap < 0.0)) {
              work[next++] = mix(previous, current, previousGap / (previousGap - gap));
            }
            if (gap >= 0.0) work[next++] = current;
            previous = current;
            previousGap = gap;
          }
          if (next < 3) return 0.0;
          count = next;
          for (int i = 0; i < 8; i++) {
            if (i >= count) break;
            polygon[i] = work[i];
          }
        }
        float twiceArea = 0.0;
        for (int i = 2; i < 8; i++) {
          if (i >= count) break;
          twiceArea += paintCross(polygon[i - 1] - polygon[0], polygon[i] - polygon[0]);
        }
        return clamp(abs(twiceArea) / (2.0 * pixelArea), 0.0, 1.0);
      }
    ` + shader.fragmentShader.replace('#include <alphatest_fragment>', `
      vec2 dx = dFdx(vPaintCoordinates), dy = dFdy(vPaintCoordinates);
      float paintPixels = paintProjection * vPaintWidth / max(0.01, vViewPosition.z);
      diffuseColor.a *= vPaintFiltered > 0.5 ? paintCoverage(vPaintCoordinates - vec2(0.0, 0.5), dx, dy)
        : smoothstep(0.23, 0.95, paintPixels);
      #include <alphatest_fragment>
    `);
  };
}
