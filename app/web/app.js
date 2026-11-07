import { biomeChoices } from "./biomes.js";
import { mountGeneration } from "./generation.js";
import { ask } from "./ask.js";
import * as THREE from "./vendor/three.module.js";
import { mountFlow } from "./flow-canvas.js";
import { mountModelEditor } from "./model-editor.js";
import { buildModel } from "./model-view.js";
import { createPlayerReference, layoutComparison, fitComparison } from "./player-reference.js";
import { mountPalette } from "./palette-editor.js";
import { mountRewards } from "./rewards-editor.js";
import { mountSpawnEditor } from "./spawn-editor.js";
import { mountBundle } from "./bundle-editor.js";
let editorMode = "wizard",
  flow,
  modelEditor,
  generation,
  paletteEditor,
  rewardsEditor,
  spawnEditor,
  bundleEditor;
const $ = (id) => document.getElementById(id);
let project,
  step = 0,
  revision = 0,
  timer,
  rotating = false,
  walking = false,
  root,
  texture;
const fields = [
  "name",
  "description",
  "namespace",
  "slug",
  "shape",
  "color",
  "accent",
  "horns",
  "scale",
  "width",
  "height",
  "behavior",
  "health",
  "damage",
  "speed",
  "spawn",
  "knockback",
  "detection",
  "attack_cooldown",
  "fire_immune",
  "can_jump",
  "gravity",
  "pushable",
  "interactions",
  "material",
];
const nums = new Set([
  "scale",
  "width",
  "height",
  "health",
  "damage",
  "speed",
  "knockback",
  "detection",
  "attack_cooldown",
]);
const checks = new Set(["horns", "fire_immune", "can_jump", "gravity", "pushable", "interactions"]);
const steps = ["idea", "look", "behavior", "export", "bundle"];
function status(s, error = false) {
  $("status").textContent = s;
  $("status").classList.toggle("error", error);
}
async function request(url, p) {
  const r = await fetch(
    url,
    p
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Ошибка сервера");
  return d;
}
function read() {
  for (const f of fields)
    project[f] = checks.has(f) ? $(f).checked : nums.has(f) ? Number($(f).value) : $(f).value;
  project.engine = $("engine").value.split(".").map(Number);
  if (project.model_palette) {
    project.model_palette[project.palette_roles.body] = project.color;
    project.model_palette[project.palette_roles.accent] = project.accent;
  }
  return project;
}
function fill() {
  for (const f of fields) {
    if (checks.has(f)) $(f).checked = project[f];
    else $(f).value = project[f];
  }
  $("engine").value = project.engine.join(".");
  $("drawingPreview").hidden = !project.drawing;
  if (project.drawing) $("drawingPreview").src = project.drawing;
  update();
  modelEditor?.reset();
  modelEditor?.render();
  flow?.render();
  generation?.refresh();
  rewardsEditor?.render();
  spawnEditor?.render();
  preview();
}
function update() {
  $("previewName").textContent = project.name;
  $("scaleValue").textContent = project.scale + "×";
  $("command").textContent = `/summon ${project.namespace}:${project.slug} ~ ~ ~`;
  $("stats").replaceChildren(
    ...[
      `${project.health} HP`,
      `${project.damage} урон`,
      project.behavior === "peaceful"
        ? "Мирный"
        : project.behavior === "neutral"
          ? "Нейтральный"
          : "Враждебный",
    ].map((s) => {
      const e = document.createElement("span");
      e.textContent = s;
      return e;
    }),
  );
  $("biomes").replaceChildren(
    biomeChoices(
      project.biomes,
      (v) => {
        project.biomes = v;
        changed();
        flow?.render();
      },
      project.spawn !== "natural",
    ),
  );
  $("importInfo").textContent = project.geometry
    ? "Используется редактируемая геометрия. Её можно менять в разделе «Редактор модели»."
    : "Используется встроенная модель.";
  $("shape").disabled = !!project.geometry;
  $("download").hidden = true;
  paletteEditor?.render();
  const customTexture = !!project.texture && !project.model_palette;
  $("color").disabled = customTexture;
  $("accent").disabled = customTexture;
  $("colorHint").textContent = customTexture
    ? "Цвета этой модели заданы импортированной PNG-текстурой. Загрузите изменённый PNG или используйте модель с палитрой."
    : project.model_palette
      ? "Цвета меняют текстуру модели и сохраняются в дополнении."
      : "";
}
function go(n) {
  setMode("wizard");
  step = Math.max(0, Math.min(steps.length - 1, n));
  document.querySelector(".workspace").hidden = step === 4;
  document
    .querySelectorAll("[data-panel]")
    .forEach((e) => (e.hidden = e.dataset.panel !== steps[step]));
  document
    .querySelectorAll("[data-step]")
    .forEach((e) => e.classList.toggle("active", e.dataset.step === steps[step]));
  $("prev").disabled = step === 0;
  $("next").hidden = step === steps.length - 1;
  if (step === 4) bundleEditor?.refresh();
}
document
  .querySelectorAll("[data-step]")
  .forEach((e) => (e.onclick = () => go(steps.indexOf(e.dataset.step))));
$("prev").onclick = () => go(step - 1);
$("next").onclick = () => go(step + 1);
for (const f of [...fields, "engine"])
  $(f).addEventListener("input", () => {
    read();
    if (f === "spawn") {
      if (project.spawn === "natural") project.population.guard = true;
      spawnEditor?.render();
    }
    update();
    clearTimeout(timer);
    timer = setTimeout(preview, 220);
    status("Есть изменения. Сохраните проект, чтобы вернуться к нему позже.");
  });
async function refreshList() {
  const list = await request("/api/projects");
  $("projects").replaceChildren(
    new Option("Сохранённые проекты", ""),
    ...list.map((p) => new Option(p.name, p.id)),
  );
  $("projects").value = project.id;
}
$("save").onclick = async () => {
  try {
    project = (await request("/api/save", read())).project;
    modelEditor.render();
    flow.render();
    rewardsEditor.render();
    paletteEditor.render();
    spawnEditor.render();
    await refreshList();
    status("Проект сохранён на компьютере.");
  } catch (e) {
    status(e.message, true);
  }
};
$("new").onclick = async () => {
  if (
    project &&
    !(await ask("Открыть новый проект? Несохранённые изменения текущего проекта будут потеряны."))
  )
    return;
  project = await request("/api/new");
  fill();
  go(0);
  status("Новый проект. Задайте имя и свойства персонажа.");
};
$("projects").onchange = async () => {
  const id = $("projects").value;
  if (!id) return;
  if (!(await ask("Открыть выбранный проект? Несохранённые изменения будут потеряны."))) return;
  try {
    project = await request("/api/project/" + id);
    fill();
    status("Проект открыт.");
  } catch (e) {
    status(e.message, true);
  }
};
function dataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
$("drawingFile").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8e6) throw Error("Рисунок до 8 МБ");
    const im = new Image();
    im.src = await dataURL(file);
    await im.decode();
    const factor = Math.min(1, 1600 / im.width, 1600 / im.height),
      c = document.createElement("canvas");
    c.width = im.width * factor;
    c.height = im.height * factor;
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    project.drawing = c.toDataURL("image/png");
    $("drawingPreview").src = project.drawing;
    $("drawingPreview").hidden = false;
    status("Рисунок добавлен. Сохраните проект.");
  } catch (e) {
    status(e.message, true);
  }
};
function clearPalette(p) {
  delete p.model_palette;
  delete p.palette_roles;
  delete p.generation;
}
$("geoFile").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 3e6) throw Error("Геометрия до 3 МБ");
    const g = JSON.parse(await f.text());
    const candidate = { ...read(), geometry: g };
    clearPalette(candidate);
    await request("/api/preview", candidate);
    project = candidate;
    update();
    await preview();
    status("Геометрия подключена. Добавьте её PNG-текстуру.");
  } catch (e) {
    status(e.message, true);
  }
};
$("textureFile").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8e6) throw Error("PNG до 8 МБ");
    const candidate = { ...read(), texture: await dataURL(f) };
    clearPalette(candidate);
    await request("/api/preview", candidate);
    project = candidate;
    update();
    await preview();
    status("Текстура подключена. Её размеры проверяются при сборке.");
  } catch (e) {
    status(e.message, true);
  }
};
$("resetModel").onclick = () => {
  delete project.geometry;
  delete project.texture;
  clearPalette(project);
  project.animate_legs = false;
  modelEditor.reset();
  modelEditor.render();
  update();
  preview();
  status("Встроенная модель восстановлена.");
};
$("export").onclick = async () => {
  const button = $("export");
  button.disabled = true;
  $("download").hidden = true;
  status("Собираю дополнение…");
  try {
    const d = await request("/api/export", read());
    project = d.project;
    modelEditor.render();
    flow.render();
    rewardsEditor.render();
    paletteEditor.render();
    spawnEditor.render();
    await refreshList();
    $("download").href = d.url;
    $("download").hidden = false;
    $("download").download = "";
    status(
      `Дополнение 1.0.${project.version} собрано и сохранено в exports. Скачайте его по ссылке.`,
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    button.disabled = false;
  }
};
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("command").textContent);
    status("Команда скопирована.");
  } catch {
    status("Выделите команду и скопируйте вручную.");
  }
};
const stage = $("scene"),
  scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
camera.position.set(45, 30, -65);
camera.lookAt(0, 14, 0);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.append(renderer.domElement);
} catch (e) {
  status("WebGL недоступен. Экспорт работает без 3D-просмотра.", true);
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x6c8354, 2.5));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(-25, 50, -30);
scene.add(light);
const grid = new THREE.GridHelper(160, 10, 0xabc29c, 0xcad9b9);
scene.add(grid);
const playerReference = createPlayerReference();
playerReference.rotation.y = 0.3;
scene.add(playerReference);
let comparisonBounds;
function fitPreview() {
  if (comparisonBounds)
    fitComparison(
      camera,
      comparisonBounds,
      Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight),
    );
}
$("showPlayer").onchange = () => {
  if (root) {
    comparisonBounds = layoutComparison(root, playerReference, $("showPlayer").checked);
    fitPreview();
  }
};
let yaw = 0.3,
  zoom = 1,
  drag = null;
stage.onpointerdown = (e) => {
  drag = e.clientX;
  stage.setPointerCapture(e.pointerId);
};
stage.onpointermove = (e) => {
  if (drag !== null) {
    yaw += (e.clientX - drag) * 0.01;
    drag = e.clientX;
  }
};
stage.onpointerup = stage.onpointercancel = () => (drag = null);
stage.onwheel = (e) => {
  e.preventDefault();
  zoom = Math.max(0.5, Math.min(2, zoom * (e.deltaY > 0 ? 1.08 : 0.92)));
  camera.zoom = 1 / zoom;
  camera.updateProjectionMatrix();
};
$("rotate").onclick = () => {
  rotating = !rotating;
  $("rotate").textContent = rotating ? "Ⅱ Вращение" : "↻ Вращение";
};
$("walk").onclick = () => {
  walking = !walking;
  $("walk").textContent = walking ? "Ⅱ Ходьба" : "▷ Ходьба";
};
$("camera").onclick = () => {
  yaw = 0.3;
  zoom = 1;
  camera.zoom = 1;
  fitPreview();
};
async function preview(candidate = null) {
  const ticket = ++revision;
  try {
    const data = candidate || (await request("/api/preview", read()));
    const tex = await new THREE.TextureLoader().loadAsync(data.texture);
    if (ticket !== revision) {
      tex.dispose();
      return;
    }
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const g = data.geometry["minecraft:geometry"][0],
      next = buildModel(g, tex, project.material, modelEditor?.selection());
    if (root) {
      scene.remove(root);
      const mats = new Set();
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material)
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      });
      mats.forEach((m) => m.dispose());
      texture?.dispose();
    }
    root = next;
    texture = tex;
    root.scale.setScalar(project.scale);
    scene.add(root);
    comparisonBounds = layoutComparison(root, playerReference, $("showPlayer").checked);
    fitPreview();
    $("walk").disabled = !!project.geometry && !project.animate_legs;
  } catch (e) {
    status(e.message, true);
  }
}
function frame(t) {
  requestAnimationFrame(frame);
  if (!renderer) return;
  const w = stage.clientWidth,
    h = stage.clientHeight;
  if (!w || !h) return;
  if (
    renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) ||
    renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())
  ) {
    renderer.setSize(w, h, false);
    fitPreview();
  }
  if (root) {
    if (rotating) yaw += 0.004;
    root.rotation.y = yaw;
    root.traverse((o) => {
      if (o.name.startsWith("leg_") && o.userData.base)
        o.rotation.x =
          o.userData.base.x +
          (walking && (!project.geometry || project.animate_legs)
            ? Math.sin(t * 0.006) * (o.name.includes("right") ? -1 : 1) * 0.45
            : 0);
    });
  }
  renderer.render(scene, camera);
}
frame(0);
function changed() {
  read();
  update();
  status("Есть изменения. Сохраните проект или соберите дополнение.");
}
function setMode(mode) {
  editorMode = mode;
  const previewPanel = document.querySelector(".preview"),
    wizard = document.querySelector(".workspace");
  document
    .querySelectorAll("[data-mode]")
    .forEach((e) => e.classList.toggle("active", e.dataset.mode === mode));
  $("canvasMode").hidden = mode !== "canvas";
  $("modelMode").hidden = mode !== "model";
  wizard.hidden = mode !== "wizard" || step === 4;
  $("bundlePanel").hidden = mode !== "wizard" || step !== 4;
  $("steps").hidden = mode !== "wizard";
  if (mode === "model") {
    $("modelPreviewSlot").append(previewPanel);
    modelEditor?.render();
  } else wizard.append(previewPanel);
  if (mode === "canvas") flow?.render();
  if (mode === "wizard" && step === 4) bundleEditor?.refresh();
  if (mode !== "canvas" && step !== 4) preview();
}
document
  .querySelectorAll("[data-mode]")
  .forEach((e) => (e.onclick = () => setMode(e.dataset.mode)));
$("bundleBack").onclick = () => go(3);
bundleEditor = mountBundle($("bundleEditor"), { request });
modelEditor = mountModelEditor($("modelEditor"), {
  getProject: () => project,
  getGeometry: async () => (await request("/api/preview", read())).geometry,
  changed,
  preview,
  error: (m) => status(m, true),
});
flow = mountFlow($("flowEditor"), {
  getProject: () => project,
  changed,
  enableInteractions: () => {
    project.interactions = true;
    $("interactions").checked = true;
  },
  openRewards: () => {
    go(2);
    $("rewardsDetails").open = true;
    $("rewardsDetails").scrollIntoView({ block: "start", behavior: "smooth" });
  },
});
paletteEditor = mountPalette($("paletteEditor"), {
  getProject: () => project,
  sync: (key, value) => {
    project[key] = value;
    $(key).value = value;
  },
  changed: () => {
    read();
    $("download").hidden = true;
    status("Цвет палитры изменён. Сохраните проект.");
    clearTimeout(timer);
    timer = setTimeout(preview, 180);
  },
});
spawnEditor = mountSpawnEditor($("spawnEditor"), {
  getProject: () => project,
  report: () => request("/api/guardrails", read()),
  changed: () => {
    $("download").hidden = true;
    status("Лимиты появления изменены. Сохраните проект.");
    flow?.render();
  },
});
rewardsEditor = mountRewards($("rewardsEditor"), {
  getProject: () => project,
  loadNpcCatalog: () => request("/npc-catalog.json"),
  changed: () => {
    $("download").hidden = true;
    status("Взаимодействия изменены. Сохраните проект.");
    flow?.render();
  },
});
generation = mountGeneration($("generationPanel"), {
  getProject: () => project,
  readProject: read,
  request,
  error: (m, e = true) => status(m, e),
  previewCandidate: preview,
  apply: async (candidate, meta) => {
    const original = JSON.parse(JSON.stringify(read()));
    // Keep a project-level backup before replacing geometry. Backups are local and not exported.
    await request("/api/model-backup", original);
    project.geometry = candidate.geometry;
    project.texture = candidate.texture;
    project.animate_legs = true;
    project.generation = meta;
    project.model_palette = candidate.palette;
    project.palette_roles = candidate.palette_roles;
    project.color = candidate.palette[candidate.palette_roles.body];
    project.accent = candidate.palette[candidate.palette_roles.accent];
    $("color").value = project.color;
    $("accent").value = project.accent;
    modelEditor.reset();
    modelEditor.render();
    update();
    await preview();
  },
});
const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
let pressed;
stage.addEventListener("pointerdown", (e) => (pressed = [e.clientX, e.clientY]));
stage.addEventListener("pointerup", (e) => {
  if (
    editorMode !== "model" ||
    !root ||
    !pressed ||
    Math.hypot(e.clientX - pressed[0], e.clientY - pressed[1]) > 5
  )
    return;
  const r = stage.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const hit = ray
    .intersectObject(root, true)
    .find((h) => h.object.isMesh && h.object.userData.bone);
  if (hit) modelEditor.select(hit.object.userData.bone, hit.object.userData.cube);
});
try {
  project = await request("/api/new");
  fill();
  await refreshList();
  status("Мастерская готова. Начните с идеи или настройте готовый шаблон.");
} catch (e) {
  status(e.message, true);
}
