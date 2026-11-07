import assert from "node:assert/strict";
import * as THREE from "./web/vendor/three.module.js";
import { buildModel } from "./web/model-view.js";
import { createPlayerReference, layoutComparison, fitComparison } from "./web/player-reference.js";
const g = {
  description: { texture_width: 64, texture_height: 64 },
  bones: [
    { name: "root", pivot: [0, 0, 0], cubes: [] },
    {
      name: "head",
      parent: "root",
      pivot: [0, 8, 0],
      cubes: [
        {
          origin: [-2, 8, -2],
          size: [4, 4, 4],
          pivot: [0, 10, 0],
          rotation: [0, 0, 30],
          inflate: 0.5,
          uv: { north: { uv: [0, 0], uv_size: [8, 8] } },
        },
      ],
    },
  ],
};
const model = buildModel(g, new THREE.Texture(), "entity_alphablend", { bone: "head", cube: 0 });
let mesh;
model.traverse((o) => {
  if (o.isMesh) mesh = o;
});
assert.equal(mesh.geometry.parameters.width, 5);
assert.equal(mesh.material[0].visible, false);
assert.equal(mesh.material[5].transparent, true);
assert.equal(mesh.userData.bone, "head");
assert.equal(mesh.userData.cube, 0);
assert.equal(model.getObjectByName("head").position.y, 8);
assert.equal(mesh.parent.rotation.z, Math.PI / 6);
const mirrored = structuredClone(g);
mirrored.bones[1].cubes[0].mirror = true;
const m = buildModel(mirrored, new THREE.Texture(), "entity_alphatest");
let other;
m.traverse((o) => {
  if (o.isMesh) other = o;
});
assert.notEqual(mesh.geometry.attributes.uv.getX(20), other.geometry.attributes.uv.getX(20));
console.log(
  "Model view: hierarchy, inflate, material, missing faces, rotation, selection and mirror passed.",
);

const player = createPlayerReference(),
  playerBox = new THREE.Box3().setFromObject(player);
assert.ok(Math.abs(playerBox.min.y) < 1e-7);
assert.ok(Math.abs(playerBox.max.y - 1.8 * 16) < 1e-6);
const playerHeight = playerBox.getSize(new THREE.Vector3()).y;
for (const scale of [0.25, 1, 3]) {
  model.scale.setScalar(scale);
  const bounds = layoutComparison(model, player, true),
    referenceBounds = new THREE.Box3().setFromObject(player);
  assert.ok(Math.abs(referenceBounds.getSize(new THREE.Vector3()).y - playerHeight) < 1e-6);
  assert.ok(!referenceBounds.intersectsBox(new THREE.Box3().setFromObject(model)));
  for (const aspect of [0.8, 2.2]) {
    const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
    fitComparison(camera, bounds, aspect);
    camera.updateMatrixWorld(true);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const screen = new THREE.Vector3(x, y, z).project(camera);
          assert.ok(
            Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && Math.abs(screen.z) < 1,
            "Comparison must fit the viewport",
          );
        }
  }
}
layoutComparison(model, player, false);
assert.equal(player.visible, false);
console.log(
  "Player reference: fixed height, ground alignment, separation, camera framing and visibility passed.",
);
