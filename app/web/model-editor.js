import { ask } from "./ask.js";
const make = (tag, text = "", className = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
};
const copy = (v) => JSON.parse(JSON.stringify(v));
export function mountModelEditor(host, api) {
  let boneIndex = 0,
    cubeIndex = 0,
    history = [],
    future = [],
    editing = false;
  function p() {
    return api.getProject();
  }
  function g() {
    return p().geometry?.["minecraft:geometry"][0];
  }
  function changed() {
    api.changed();
    api.preview();
    if (!editing) render();
  }
  function snapshot() {
    history.push(copy(p().geometry));
    if (history.length > 40) history.shift();
    future = [];
  }
  function edit(fn) {
    snapshot();
    fn();
    changed();
  }
  function button(text, fn) {
    const e = make("button", text);
    e.onclick = fn;
    return e;
  }
  function row(
    parent,
    label,
    value,
    fn,
    { type = "number", min = -1024, max = 1024, step = 0.25 } = {},
  ) {
    const l = make("label", label),
      input = make("input");
    input.type = type;
    if (type === "checkbox") input.checked = value;
    else input.value = value;
    if (type === "number") {
      input.min = min;
      input.max = max;
      input.step = step;
    }
    input.oninput = () => {
      const val =
        type === "checkbox" ? input.checked : type === "number" ? Number(input.value) : input.value;
      if (type === "number" && (!Number.isFinite(val) || val < min || val > max)) {
        api.error(`${label}: допустимо ${min}–${max}`);
        input.value = value;
        return;
      }
      editing = true;
      try {
        fn(val);
      } finally {
        editing = false;
      }
    };
    input.onchange = () => render();
    l.append(input);
    parent.append(l);
    return input;
  }
  function vector(parent, label, obj, key, defaults = [0, 0, 0], positive = false) {
    const field = make("fieldset"),
      legend = make("legend", label),
      r = make("div", "", "vector-row");
    field.append(legend, r);
    ["X", "Y", "Z"].forEach((axis, i) =>
      row(
        r,
        axis,
        (obj[key] || defaults)[i],
        (v) =>
          edit(() => {
            if (key === "rotation" && obj.origin && !obj.pivot) obj.pivot = [...obj.origin];
            obj[key] ||= [...defaults];
            obj[key][i] = v;
          }),
        { min: positive ? 0.01 : -1024, max: 1024 },
      ),
    );
    parent.append(field);
  }
  function unique(prefix) {
    let n = 1;
    while (g().bones.some((b) => b.name === prefix + n)) n++;
    return prefix + n;
  }
  function render() {
    host.replaceChildren();
    const tools = make("div", "", "model-toolbar");
    tools.append(
      button("↶ Отменить", () => {
        if (!history.length) return;
        future.push(copy(p().geometry));
        p().geometry = history.pop();
        changed();
      }),
      button("↷ Повторить", () => {
        if (!future.length) return;
        history.push(copy(p().geometry));
        p().geometry = future.pop();
        changed();
      }),
    );
    tools.children[0].disabled = !history.length;
    tools.children[1].disabled = !future.length;
    host.append(make("h2", "Редактор кубической модели"), tools);
    if (!g()) {
      host.append(
        make(
          "p",
          "Превратите выбранный шаблон в редактируемую модель. Дальше можно менять кости, добавлять детали и редактировать каждый куб.",
        ),
        button("Редактировать текущую модель", async () => {
          try {
            p().geometry = await api.getGeometry();
            p().animate_legs = true;
            history = [];
            future = [];
            changed();
          } catch (e) {
            api.error(e.message);
          }
        }),
      );
      return;
    }
    const geo = g(),
      bones = geo.bones;
    boneIndex = Math.min(boneIndex, bones.length - 1);
    const bone = bones[boneIndex];
    bone.cubes ||= [];
    cubeIndex = Math.min(cubeIndex, Math.max(0, bone.cubes.length - 1));
    const tree = make("div", "", "model-tree"),
      select = make("select");
    select.setAttribute("aria-label", "Кость модели");
    bones.forEach((b, i) => {
      const o = make("option", (b.parent ? "↳ " : "") + b.name);
      o.value = i;
      select.append(o);
    });
    select.value = boneIndex;
    select.onchange = () => {
      boneIndex = Number(select.value);
      cubeIndex = 0;
      render();
      api.preview();
    };
    tree.append(
      make("label", "Кость"),
      select,
      button("+ Кость", () =>
        edit(() => {
          bones.push({
            name: unique("bone_"),
            parent: bone.name,
            pivot: [...(bone.pivot || [0, 0, 0])],
            cubes: [],
          });
          boneIndex = bones.length - 1;
          cubeIndex = 0;
        }),
      ),
      button("Удалить кость", async () => {
        if (bones.length === 1) return;
        if (await ask("Удалить кость и её кубы? Дочерние кости будут переподключены."))
          edit(() => {
            for (const b of bones)
              if (b.parent === bone.name) {
                if (bone.parent) b.parent = bone.parent;
                else delete b.parent;
              }
            bones.splice(boneIndex, 1);
            boneIndex = 0;
            cubeIndex = 0;
          });
      }),
    );
    host.append(tree);
    row(
      host,
      "Имя кости",
      bone.name,
      (v) => {
        if (!/^[A-Za-z0-9_]{1,80}$/.test(v) || bones.some((b) => b !== bone && b.name === v)) {
          api.error("Имя кости должно быть уникальным: латиница, цифры, _.");
          render();
          return;
        }
        edit(() => {
          const old = bone.name;
          bone.name = v;
          bones.forEach((b) => {
            if (b.parent === old) b.parent = v;
          });
        });
      },
      { type: "text" },
    );
    const parents = make("select");
    parents.setAttribute("aria-label", "Родитель кости");
    const none = make("option", "Корень сцены");
    none.value = "";
    parents.append(none);
    const descendant = (b) => {
      let n = b;
      for (let i = 0; i < bones.length; i++) {
        if (n === bone) return true;
        n = bones.find((x) => x.name === n.parent);
        if (!n) return false;
      }
      return true;
    };
    bones
      .filter((b) => !descendant(b))
      .forEach((b) => {
        const o = make("option", b.name);
        o.value = b.name;
        parents.append(o);
      });
    parents.value = bone.parent || "";
    parents.onchange = () =>
      edit(() => {
        if (parents.value) bone.parent = parents.value;
        else delete bone.parent;
      });
    host.append(make("label", "Родитель кости"), parents);
    vector(host, "Центр вращения кости (pivot)", bone, "pivot");
    vector(host, "Поворот кости, градусы", bone, "rotation");
    const cubeTools = make("div", "", "model-toolbar"),
      cs = make("select");
    cs.setAttribute("aria-label", "Куб модели");
    bone.cubes.forEach((c, i) => {
      const o = make("option", "Куб " + (i + 1));
      o.value = i;
      cs.append(o);
    });
    cs.value = cubeIndex;
    cs.onchange = () => {
      cubeIndex = Number(cs.value);
      render();
      api.preview();
    };
    cubeTools.append(
      cs,
      button("+ Куб", () =>
        edit(() => {
          bone.cubes.push({
            origin: [-2, 20, -2],
            size: [4, 4, 4],
            uv: [0, 0],
            pivot: [0, 22, 0],
            rotation: [0, 0, 0],
          });
          cubeIndex = bone.cubes.length - 1;
        }),
      ),
    );
    host.append(make("h3", "Кубы этой кости"), cubeTools);
    const cube = bone.cubes[cubeIndex];
    if (cube) {
      host.append(
        button("Дублировать куб", () =>
          edit(() => {
            const c = copy(cube);
            c.origin[0] += 2;
            bone.cubes.push(c);
            cubeIndex = bone.cubes.length - 1;
          }),
        ),
        button("Удалить куб", () =>
          edit(() => {
            bone.cubes.splice(cubeIndex, 1);
            cubeIndex = 0;
          }),
        ),
      );
      vector(host, "Положение (origin), пиксели", cube, "origin");
      vector(host, "Размер, пиксели", cube, "size", [4, 4, 4], true);
      vector(host, "Центр вращения куба", cube, "pivot", cube.origin);
      vector(host, "Поворот куба, градусы", cube, "rotation");
      row(
        host,
        "Inflate: расширение всех граней",
        cube.inflate || 0,
        (v) => {
          if (cube.size.some((s) => s + v * 2 <= 0)) {
            api.error("Inflate не должен делать куб пустым");
            return;
          }
          edit(() => (cube.inflate = v));
        },
        { min: -32, max: 32, step: 0.1 },
      );
      row(
        host,
        "Зеркальная UV-развёртка",
        cube.mirror ?? bone.mirror ?? false,
        (v) => edit(() => (cube.mirror = v)),
        { type: "checkbox" },
      );
      const uv = make("details"),
        summary = make("summary", "UV: текстура на гранях");
      uv.append(summary);
      if (Array.isArray(cube.uv)) {
        const r = make("div", "", "vector-row");
        ["U", "V"].forEach((axis, i) =>
          row(r, axis, cube.uv[i], (v) => edit(() => (cube.uv[i] = v)), { min: -8192, max: 8192 }),
        );
        uv.append(
          r,
          button("Задать каждую грань отдельно", () =>
            edit(() => {
              cube.uv = Object.fromEntries(
                ["north", "south", "east", "west", "up", "down"].map((f) => [
                  f,
                  { uv: [0, 0], uv_size: [8, 8] },
                ]),
              );
            }),
          ),
        );
      } else
        for (const f of ["north", "south", "east", "west", "up", "down"]) {
          const d = make("details");
          d.append(make("summary", f));
          row(
            d,
            "Грань видима",
            !!cube.uv[f],
            (v) =>
              edit(() => {
                if (v) cube.uv[f] = { uv: [0, 0], uv_size: [8, 8] };
                else delete cube.uv[f];
              }),
            { type: "checkbox" },
          );
          if (cube.uv[f]) {
            for (const key of ["uv", "uv_size"]) {
              const r = make("div", "", "vector-row");
              d.append(make("label", key === "uv" ? "Положение U/V" : "Ширина / высота UV"), r);
              ["U", "V"].forEach((a, i) =>
                row(
                  r,
                  a,
                  (cube.uv[f][key] || [8, 8])[i],
                  (v) =>
                    edit(() => {
                      cube.uv[f][key] ||= [8, 8];
                      cube.uv[f][key][i] = v;
                    }),
                  { min: -8192, max: 8192 },
                ),
              );
            }
          }
          uv.append(d);
        }
      host.append(uv);
    }
    const details = make("details");
    details.append(make("summary", "Границы видимости и анимация"));
    row(
      details,
      "Ширина visible bounds, блоки",
      geo.description.visible_bounds_width || 6,
      (v) => edit(() => (geo.description.visible_bounds_width = v)),
      { min: 0.1, max: 128 },
    );
    row(
      details,
      "Высота visible bounds, блоки",
      geo.description.visible_bounds_height || 6,
      (v) => edit(() => (geo.description.visible_bounds_height = v)),
      { min: 0.1, max: 128 },
    );
    vector(details, "Смещение visible bounds", geo.description, "visible_bounds_offset");
    row(
      details,
      "Шаблонная ходьба костей leg_*",
      p().animate_legs,
      (v) => {
        p().animate_legs = v;
        changed();
      },
      { type: "checkbox" },
    );
    details.append(
      make(
        "p",
        "Размер PNG должен совпадать с texture_width/height геометрии. Hitbox задаётся отдельно на холсте параметров. 16 пикселей модели = 1 блок.",
        "hint",
      ),
    );
    host.append(details);
    host.append(
      button("Скачать .geo.json", () => {
        const blob = new Blob([JSON.stringify(p().geometry, null, 2)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = make("a");
        a.href = url;
        a.download = p().slug + ".geo.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
  }
  function selection() {
    return g() ? { bone: g().bones[boneIndex]?.name, cube: cubeIndex } : null;
  }
  return {
    render,
    selection,
    reset() {
      history = [];
      future = [];
      boneIndex = 0;
      cubeIndex = 0;
    },
    select(bone, cube) {
      const i = g()?.bones.findIndex((b) => b.name === bone);
      if (i >= 0) {
        boneIndex = i;
        cubeIndex = cube;
        render();
        api.preview();
      }
    },
  };
}
