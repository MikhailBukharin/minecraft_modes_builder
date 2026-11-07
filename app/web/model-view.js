import * as THREE from "./vendor/three.module.js";
export function buildModel(g, texture, materialName, selection) {
  const root = new THREE.Group(),
    groups = new Map(),
    transparent = materialName === "entity_alphablend";
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    alphaTest: transparent ? 0 : 0.1,
    transparent,
    side: THREE.DoubleSide,
  });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  for (const b of g.bones) {
    const group = new THREE.Group();
    group.name = b.name;
    group.userData.pivot = b.pivot || [0, 0, 0];
    groups.set(b.name, group);
  }
  for (const b of g.bones) {
    const group = groups.get(b.name),
      pivot = group.userData.pivot,
      parent = groups.get(b.parent),
      pp = parent?.userData.pivot || [0, 0, 0];
    group.position.set(...pivot.map((v, i) => v - pp[i]));
    (parent || root).add(group);
    if (b.rotation) group.rotation.set(...b.rotation.map((v) => (v * Math.PI) / 180), "ZYX");
    group.userData.base = group.rotation.clone();
    for (const [index, cube] of (b.cubes || []).entries()) {
      const inflate = cube.inflate || 0,
        size = cube.size.map((v) => v + inflate * 2),
        geo = new THREE.BoxGeometry(...size),
        uv = geo.attributes.uv;
      const faces = ["east", "west", "up", "down", "south", "north"];
      let mapping = cube.uv;
      if (Array.isArray(mapping)) {
        const [u, v] = mapping,
          [x, y, z] = cube.size;
        mapping = {
          west: { uv: [u, v + z], uv_size: [z, y] },
          north: { uv: [u + z, v + z], uv_size: [x, y] },
          east: { uv: [u + z + x, v + z], uv_size: [z, y] },
          south: { uv: [u + 2 * z + x, v + z], uv_size: [x, y] },
          up: { uv: [u + z, v], uv_size: [x, z] },
          down: { uv: [u + z + x, v], uv_size: [x, z] },
        };
      }
      const mirror = cube.mirror ?? b.mirror ?? false;
      const materials = [];
      faces.forEach((face, i) => {
        const f = mirror ? (face === "east" ? "west" : face === "west" ? "east" : face) : face,
          q = mapping[f];
        materials.push(q ? material : hidden);
        if (!q) return;
        const defaultSize = ["east", "west"].includes(f)
          ? [cube.size[2], cube.size[1]]
          : ["up", "down"].includes(f)
            ? [cube.size[0], cube.size[2]]
            : [cube.size[0], cube.size[1]];
        const [u, v] = q.uv,
          [w, h] = q.uv_size || defaultSize;
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].forEach(([x, y], j) =>
          uv.setXY(
            i * 4 + j,
            (u + (mirror ? 1 - x : x) * w) / g.description.texture_width,
            1 - (v + y * h) / g.description.texture_height,
          ),
        );
      });
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, materials),
        cp = cube.pivot || cube.origin,
        holder = new THREE.Group();
      holder.position.set(...cp.map((v, i) => v - pivot[i]));
      mesh.position.set(...cube.origin.map((v, i) => v + cube.size[i] / 2 - cp[i]));
      if (cube.rotation)
        holder.rotation.set(...cube.rotation.map((v) => (v * Math.PI) / 180), "ZYX");
      mesh.userData = { bone: b.name, cube: index };
      holder.add(mesh);
      group.add(holder);
      if (selection?.bone === b.name && selection?.cube === index) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0xe5a22b, depthTest: false }),
        );
        outline.position.copy(mesh.position);
        outline.renderOrder = 2;
        holder.add(outline);
      }
    }
  }
  return root;
}
