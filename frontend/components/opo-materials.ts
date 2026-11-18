import * as T from 'three';

const surfaces = {
  asphalt: { tile: 2, relief: 0.32 },
  cobble: { tile: 2.6, relief: 0.5 },
  forest: { tile: 3.8, relief: 0.58 },
  grass: { tile: 4.2, relief: 0.55 },
  stonewall: { tile: 2.8, relief: 0.65 },
  water: { tile: 5.2, relief: 0.32 },
};

export type TourSurface = Exclude<keyof typeof surfaces, 'water'>;

export function surfaceUV(geometry: T.BufferGeometry, surface: keyof typeof surfaces, wall = false) {
  const { tile } = surfaces[surface];
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  let distance = 0;
  for (let i = 0; i < position.count; i++) {
    if (wall && i > 0 && i % 2 === 0) {
      distance += Math.hypot(position.getX(i) - position.getX(i - 2), position.getZ(i) - position.getZ(i - 2));
    }
    uv[i * 2] = (wall ? distance : position.getX(i)) / tile;
    uv[i * 2 + 1] = (wall ? position.getY(i) : -position.getZ(i)) / tile;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
}

// Adapted from the PBR texture loader in Walkable City. See tour-materials/CREDITS.txt.
export function createTourMaterials(anisotropy: number, fullDetail: boolean) {
  const loader = new T.TextureLoader();
  const textures = new Map<string, T.Texture>();
  function texture(file: string, color: boolean) {
    const cached = textures.get(file);
    if (cached) return cached;
    const map = loader.load(`/tour-materials/${file}.webp`);
    if (color) map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    map.anisotropy = anisotropy;
    textures.set(file, map);
    return map;
  }
  return function apply(material: T.MeshStandardMaterial, surface: TourSurface) {
    material.map = texture(`${surface}_diff`, true);
    // The source is fresh racing tarmac. Raise the albedo for weathered local roads.
    if (surface === 'asphalt') material.color.multiplyScalar(6);
    if (fullDetail) {
      material.normalMap = texture(`${surface}_nor`, false);
      material.normalScale.setScalar(surfaces[surface].relief);
      material.roughnessMap = texture(`${surface}_rough`, false);
    }
    return material;
  };
}

export type TourMaterials = ReturnType<typeof createTourMaterials>;

export function detailGround(material: T.MeshStandardMaterial, texture: T.Texture) {
  const strength = { value: 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms.groundTexture = { value: texture };
    shader.uniforms.groundStrength = strength;
    shader.vertexShader = 'varying vec2 groundUV;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n groundUV = vec2(position.x, -position.z) / 3.8;',
    );
    shader.fragmentShader = 'varying vec2 groundUV;\n uniform sampler2D groundTexture;\n uniform float groundStrength;\n'
      + shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        if (groundStrength > 0.0 && vViewPosition.z < 230.0) {
          float closeUp = 1.0 - smoothstep(25.0, 230.0, vViewPosition.z);
          vec3 sampleColor = texture2D(groundTexture, groundUV).rgb;
          float grain = clamp(dot(sampleColor, vec3(0.27, 0.65, 0.08)) * 3.1 + 0.60, 0.62, 1.42);
          diffuseColor.rgb *= mix(1.0, grain, closeUp * groundStrength);
        }
      `);
  };
  return strength;
}

// The finite-difference normal map follows Walkable City's river material.
export function riverNormals() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const step = Math.PI * 2 / size;
  const height = (x: number, y: number) =>
    Math.sin((2 * x + 5 * y) * step) * 0.44
    + Math.sin((5 * x - 3 * y) * step) * 0.31
    + Math.sin((7 * x + 2 * y) * step) * 0.17;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels[i] = 128 + (height(x + 1, y) - height(x - 1, y)) * 82;
    pixels[i + 1] = 128 + (height(x, y + 1) - height(x, y - 1)) * 82;
    pixels[i + 2] = 255;
    pixels[i + 3] = 255;
  }
  const map = new T.DataTexture(pixels, size, size);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.magFilter = T.LinearFilter;
  map.needsUpdate = true;
  return map;
}
