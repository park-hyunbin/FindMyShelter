import { Group, Mesh, MeshBasicMaterial, type Scene } from 'three';

export function createStudyShadows(scene: Scene, terrain: Mesh, buildings: Mesh[]) {
  const model = new Set([terrain, ...buildings]);
  const scenery: Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof Mesh && object.castShadow && !model.has(object)) scenery.push(object);
  });

  let depthCasters: Group | undefined;
  let active = false;
  return (enabled: boolean) => {
    if (active === enabled) return false;
    if (enabled && !depthCasters) {
      depthCasters = new Group();
      const hiddenBuildings = buildings.filter(mesh => !mesh.visible);
      if (hiddenBuildings.length) {
        // The shadow pass uses its own depth material. The visible pass keeps the detailed facade.
        const material = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        for (const mesh of hiddenBuildings) {
          const caster = new Mesh(mesh.geometry, material);
          caster.matrixAutoUpdate = false;
          caster.matrix.copy(mesh.matrixWorld);
          caster.castShadow = true;
          depthCasters.add(caster);
        }
      }
      scene.add(depthCasters);
    }
    active = enabled;
    if (depthCasters) depthCasters.visible = enabled;
    for (const mesh of scenery) mesh.castShadow = !enabled;
    return true;
  };
}
