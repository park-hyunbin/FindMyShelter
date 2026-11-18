import * as T from 'three';

// Gradient dome and directional glow adapted from Walkable City (MIT).
export function createTourSky(scene: T.Scene) {
  const uniforms = {
    zenith: { value: new T.Color() },
    horizon: { value: new T.Color() },
    lowerSky: { value: new T.Color() },
    sunDirection: { value: new T.Vector3() },
    glow: { value: 0 },
  };
  const sky = new T.Mesh(new T.SphereGeometry(1, 32, 20), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform vec3 zenith, horizon, lowerSky, sunDirection;
      uniform float glow;
      varying vec3 direction;
      void main() {
        vec3 ray = normalize(direction);
        float height = smoothstep(0.0, 0.6, ray.y);
        vec3 sky = mix(mix(lowerSky, horizon, smoothstep(-0.14, 0.0, ray.y)), zenith, height);
        float scatter = pow(max(0.0, dot(ray, sunDirection)), 24.0);
        sky += vec3(0.28, 0.21, 0.12) * scatter * glow;
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  }));
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);
  const haze = new T.Color();
  return {
    follow(camera: T.Camera) { sky.position.copy(camera.position); },
    light(direction: T.Vector3, altitude: number, fog: T.Color) {
      const daylight = T.MathUtils.smoothstep(altitude, -0.11, 0.16);
      const sunset = T.MathUtils.smoothstep(altitude, -0.08, 0.04)
        * (1 - T.MathUtils.smoothstep(altitude, 0.04, 0.33));
      uniforms.sunDirection.value.copy(direction);
      uniforms.zenith.value.set('#14253b').lerp(haze.set('#7097bb'), daylight);
      uniforms.horizon.value.set('#414d66').lerp(haze.set('#d7e4e6'), daylight)
        .lerp(haze.set('#f1d4b1'), sunset * 0.54);
      uniforms.lowerSky.value.set('#263750').lerp(haze.set('#96a9af'), daylight);
      uniforms.glow.value = daylight * 0.65 + sunset * 0.7;
      fog.copy(uniforms.lowerSky.value).lerp(uniforms.horizon.value, 0.4);
    },
  };
}
