import * as THREE from "./vendor/three.module.js";

export const UNITS_PER_BLOCK = 16,
  PLAYER_HEIGHT_BLOCKS = 1.8;

// Original block figure, calibrated to standing player collision height.
export function createPlayerReference() {
  const figure = new THREE.Group();
  figure.name = "player-size-reference";
  const colors = {
    skin: 0xb98560,
    hair: 0x49372c,
    shirt: 0x3f999e,
    pants: 0x53668f,
    boots: 0x39484c,
    white: 0xf5eee2,
    eyes: 0x37516a,
  };
  const materials = Object.fromEntries(
    Object.entries(colors).map(([k, color]) => [k, new THREE.MeshLambertMaterial({ color })]),
  );
  function box(name, size, position, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), materials[color]);
    mesh.name = name;
    mesh.position.set(...position);
    figure.add(mesh);
  }
  box("body", [8, 12, 4], [0, 18, 0], "shirt");
  for (const side of [-1, 1]) {
    box("leg", [4, 12, 4], [side * 2, 6, 0], "pants");
    box("boot", [4.02, 2, 4.02], [side * 2, 1, 0], "boots");
    box("arm", [4, 12, 4], [side * 6, 18, 0], "skin");
    box("sleeve", [4.02, 4, 4.02], [side * 6, 22, 0], "shirt");
    box("eye-white", [1.8, 1, 0.08], [side * 2.1, 28, -4.04], "white");
    box("eye", [0.75, 1, 0.1], [side * 1.8, 28, -4.09], "eyes");
  }
  box("head", [8, 8, 8], [0, 28, 0], "skin");
  box("hair-top", [8, 1.5, 8], [0, 31.25, 0], "hair");
  box("hair-back", [8, 6, 0.12], [0, 28, 3.96], "hair");
  box("mouth", [2, 0.6, 0.1], [0, 25.5, -4.06], "hair");
  figure.scale.setScalar((PLAYER_HEIGHT_BLOCKS * UNITS_PER_BLOCK) / 32);
  return figure;
}

const viewDirection = new THREE.Vector3(45, 16, -65).normalize();
const screenRight = new THREE.Vector3()
  .crossVectors(new THREE.Vector3(0, 1, 0), viewDirection)
  .normalize();

export function layoutComparison(monster, player, showPlayer) {
  const yaw = monster.rotation.y;
  monster.rotation.y = 0;
  const box = new THREE.Box3().setFromObject(monster);
  monster.rotation.y = yaw;
  monster.updateMatrixWorld(true);
  const radius = Math.max(
    ...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x, z))),
  );
  // Reserve enough room for every viewing angle, so rotation does not crop the model.
  const bounds = new THREE.Box3(
    new THREE.Vector3(-radius, Math.min(0, box.min.y), -radius),
    new THREE.Vector3(radius, box.max.y, radius),
  );
  player.visible = showPlayer;
  if (showPlayer) {
    player.position.copy(screenRight).multiplyScalar(radius + 13);
    bounds.union(new THREE.Box3().setFromObject(player));
  }
  return bounds;
}

export function fitComparison(camera, bounds, aspect) {
  const target = bounds.getCenter(new THREE.Vector3()),
    up = new THREE.Vector3().crossVectors(viewDirection, screenRight).normalize();
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2),
    horizontal = vertical * aspect;
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(target),
          depth = v.dot(viewDirection);
        distance = Math.max(
          distance,
          depth + (1.12 * Math.abs(v.dot(screenRight))) / horizontal,
          depth + (1.12 * Math.abs(v.dot(up))) / vertical,
        );
      }
  camera.aspect = aspect;
  camera.position.copy(target).addScaledVector(viewDirection, distance);
  camera.far = Math.max(1000, distance + bounds.getSize(new THREE.Vector3()).length() * 2);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}
