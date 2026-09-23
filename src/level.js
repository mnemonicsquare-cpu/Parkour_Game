import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export const zones = [
  { name: 'Свободное движение', at: [0, 0, 4] },
  { name: 'Низкие препятствия', at: [-11, 0, -3] },
  { name: 'Подкат', at: [-23, 0, -2] },
  { name: 'Лазание', at: [11, 0, -3] },
  { name: 'Крыши', at: [5, 3, -21] },
  { name: 'Приземление', at: [-15, 5, -24] },
  { name: 'Непрерывный маршрут', at: [0, 0, -12] },
];

export function createLevel(scene, world) {
  const obstacles = [];
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: .02 });
  const palette = { ground: mat(0x596370), solid: mat(0x727b85), vault: mat(0xd2a55f), climb: mat(0x5eabc1), roof: mat(0x8a9caa), wall: mat(0x535865), overhead: mat(0x9b85b2), accent: mat(0xd77369) };
  function box(x, y, z, w, h, d, kind = 'solid', ledge = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), palette[kind]);
    mesh.position.set(x, y + h / 2, z); mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);
    const entry = { x, y, z, w, h, d, top: y + h, kind, ledge, mesh, collider };
    obstacles.push(entry); collider.userData = entry;
    return entry;
  }
  box(0, -.6, -10, 64, .6, 80, 'ground');
  // Spawn and running field.
  for (let i = 0; i < 8; i++) box(-15 + i * 4, -.28, 8, .08, .04, 14, 'accent');
  // Vaults (amber), low walls, and a wall that must stop the controller.
  box(-11, 0, -8, 4, .65, .55, 'vault');
  box(-16, 0, -13, 2.5, .9, .7, 'vault');
  box(-7, 0, -14, 3, 1.15, .8, 'climb', true);
  box(15, 0, -11, 4, 2.3, .8, 'climb', true);
  box(8, 0, -12, 3, 1.6, 1, 'climb', true);
  box(20, 0, -15, 4, 4.2, 1, 'wall');
  // Slide lane: 1.05 m of headroom under a 3 m deep lintel.
  box(-23, 1.05, -8, 4, .7, 3, 'overhead');
  box(-24.8, 0, -8, .4, 1.05, 3, 'overhead');
  box(-21.2, 0, -8, .4, 1.05, 3, 'overhead');
  // Roof run and controlled drops.
  box(6.2, 0, -21, 7, 3, 7, 'roof', true);
  box(6.2, 0, -32, 7, 3.4, 7, 'roof', true);
  box(14, 0, -28, 5, 4.4, 6, 'roof', true);
  box(-16, 0, -24, 5, 5, 5, 'roof', true);
  box(-16, 0, -34, 5, 3, 5, 'roof', true);
  box(-8, 0, -34, 5, 1, 5, 'roof', true);
  // Continuous route.
  box(0, 0, -14, 4, .7, .65, 'vault');
  box(0, 0, -18, 4, 1.65, 1, 'climb', true);
  box(0, 0, -24, 5, 2.3, 5, 'roof', true);
  box(0, 0, -32, 5, 2.8, 5, 'roof', true);
  for (const x of [-32, 32]) box(x, 0, -10, .6, 7, 80, 'wall');
  for (const z of [-49, 29]) box(0, 0, z, 64, 7, .6, 'wall');
  const grid = new THREE.GridHelper(64, 32, 0x98a5ad, 0x68747d); grid.position.y = -.286; scene.add(grid);
  return { obstacles, box };
}
