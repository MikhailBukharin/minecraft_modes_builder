import { ask } from "./ask.js";
import { runStory } from "./story-runner.js";
import { types, uid, makeNode, ports, LANDMARKS, EFFECTS, SOUNDS } from "./story-blocks.js";
import { examples } from "./story-examples.js";
import { ITEMS } from "./items.js";
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}
export function mountFlow(host, api) {
  let activeStory = "",
    pending = null,
    zoom = 1,
    simToken = 0;
  const toolbar = el("div", { class: "flow-toolbar" }),
    tabs = el("div", { class: "flow-tabs" }),
    left = el("aside", { class: "flow-palette" }),
    viewport = el("div", { class: "flow-viewport", tabindex: "0" }),
    surface = el("div", { class: "flow-surface" }),
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("flow-edges");
  surface.append(svg);
  viewport.append(surface);
  const log = el("div", { class: "flow-log", role: "status" }),
    row = el("div", { class: "flow-row" }, left, viewport);
  host.append(toolbar, tabs, row, log);
  const project = () => api.getProject(),
    story = () => project().stories.find((s) => s.id === activeStory);
  function button(label, fn) {
    return el("button", { onclick: fn }, label);
  }
  function change() {
    api.changed();
    pending = null;
    log.textContent = "Изменения холста сохраняются вместе с проектом.";
  }
  function setZoom(v) {
    zoom = Math.max(0.2, Math.min(1.5, v));
    surface.style.zoom = zoom;
    drawEdges();
  }
  function fit() {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    const nodes = [...surface.querySelectorAll(".flow-node")];
    if (!nodes.length) return;
    const right = Math.max(...nodes.map((n) => n.offsetLeft + n.offsetWidth)) + 40,
      bottom = Math.max(...nodes.map((n) => n.offsetTop + n.offsetHeight)) + 40;
    setZoom(
      Math.min(1, (viewport.clientWidth - 20) / right, (viewport.clientHeight - 20) / bottom),
    );
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
  function render() {
    simToken++;
    pending = null;
    toolbar.replaceChildren(
      el("strong", {}, "Истории и диалоги"),
      button("−", () => setZoom(zoom - 0.1)),
      button("+", () => setZoom(zoom + 0.1)),
      button("100%", () => setZoom(1)),
      button("Вписать", fit),
      button("Развернуть", () => {
        host.classList.toggle("flow-fullscreen");
        requestAnimationFrame(fit);
      }),
    );
    tabs.replaceChildren();
    left.replaceChildren();
    surface.querySelectorAll(".flow-node").forEach((n) => n.remove());
    renderStories();
    log.textContent =
      "Соедините выход справа со входом слева. Условия, торговля и путь имеют два выхода. Щелчок по линии удаляет её.";
    requestAnimationFrame(() => {
      drawEdges();
      if (zoom === 1) fit();
    });
  }
  function card(id, title, color, x, y) {
    const n = el("article", {
        class: "flow-node " + color,
        "data-node": id,
        style: `left:${x}px;top:${y}px`,
      }),
      header = el(
        "div",
        { class: "node-header", tabindex: "0" },
        title,
        el("span", { class: "drag-mark" }, "⠿"),
      );
    n.append(header);
    surface.append(n);
    header.onpointerdown = (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      header.setPointerCapture(e.pointerId);
      const sx = e.clientX,
        sy = e.clientY,
        ox = parseFloat(n.style.left),
        oy = parseFloat(n.style.top);
      const move = (ev) => {
        const x = Math.max(0, Math.min(2700, ox + (ev.clientX - sx) / zoom)),
          y = Math.max(0, Math.min(1700, oy + (ev.clientY - sy) / zoom));
        n.style.left = x + "px";
        n.style.top = y + "px";
        savePos(id, x, y);
        drawEdges();
      };
      header.onpointermove = move;
      header.onpointerup = () => {
        header.onpointermove = null;
        change();
      };
      header.onpointercancel = () => {
        header.onpointermove = null;
      };
    };
    header.onkeydown = (e) => {
      const delta = {
        ArrowLeft: [-20, 0],
        ArrowRight: [20, 0],
        ArrowUp: [0, -20],
        ArrowDown: [0, 20],
      }[e.key];
      if (delta) {
        e.preventDefault();
        const x = Math.max(0, parseFloat(n.style.left) + delta[0]),
          y = Math.max(0, parseFloat(n.style.top) + delta[1]);
        n.style.left = x + "px";
        n.style.top = y + "px";
        savePos(id, x, y);
        change();
        drawEdges();
      }
    };
    return n;
  }
  function savePos(id, x, y) {
    const n = story()?.nodes.find((n) => n.id === id);
    if (n) {
      n.x = x;
      n.y = y;
    }
  }
  function field(node, label, type, value, onchange, min, max, step) {
    const wrap = el("label", {}, label);
    let input;
    if (typeof type === "object") {
      input = el("select");
      for (const [v, t] of Object.entries(type)) input.append(el("option", { value: v }, t));
      input.value = value;
    } else if (type === "textarea") {
      input = el("textarea", { rows: "3" });
      input.value = value;
    } else {
      input = el("input", { type: type === "check" ? "checkbox" : type });
      if (type === "check") input.checked = value;
      else input.value = value;
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      if (step !== undefined) input.step = step;
    }
    input.oninput = () => {
      onchange(
        type === "check" ? input.checked : type === "number" ? Number(input.value) : input.value,
      );
      change();
    };
    wrap.append(input);
    node.append(wrap);
    return input;
  }
  function renderStories() {
    if (!story()) activeStory = project().stories[0]?.id || "";
    const select = el("select", { "aria-label": "Выбрать историю" });
    project().stories.forEach((s) => select.append(el("option", { value: s.id }, s.name)));
    select.value = activeStory;
    select.onchange = () => {
      activeStory = select.value;
      render();
    };
    function add(s) {
      if (project().stories.length >= 20) {
        log.textContent = "В одном проекте может быть не более 20 историй.";
        return;
      }
      project().stories.push(s);
      activeStory = s.id;
      api.enableInteractions();
      change();
      render();
    }
    tabs.append(
      select,
      button("+ История", () =>
        add({ id: uid(), name: "Новая история", nodes: [makeNode("start", 70, 100)], edges: [] }),
      ),
    );
    const example = el(
      "select",
      { "aria-label": "Готовые примеры историй" },
      el("option", { value: "" }, "Добавить готовый пример…"),
    );
    examples.forEach(([name], i) => example.append(el("option", { value: String(i) }, name)));
    example.onchange = () => {
      if (example.value !== "") add(examples[Number(example.value)][1]());
    };
    tabs.append(example, button("Настроить торговлю", api.openRewards));
    if (!story()) {
      left.append(
        el(
          "p",
          {},
          "Добавьте историю или готовый пример. Каждая история появится в игровом меню героя.",
        ),
      );
      return;
    }
    const s = story(),
      name = el("input", { "aria-label": "Название истории", maxlength: "80" });
    name.value = s.name;
    name.oninput = () => {
      s.name = name.value;
      select.selectedOptions[0].textContent = s.name;
      change();
    };
    tabs.append(
      name,
      button("▶ Проверить в редакторе", simulate),
      button("Стоп", () => {
        simToken++;
      }),
      button("Удалить историю", async () => {
        if (await ask("Удалить эту историю?")) {
          project().stories = project().stories.filter((q) => q.id !== s.id);
          change();
          render();
        }
      }),
    );
    left.append(el("h3", {}, "Блоки истории"));
    for (const [type, [name, color]] of Object.entries(types)) {
      left.append(
        el(
          "button",
          {
            class: "palette-block " + color,
            onclick: () => {
              if (type === "start" && s.nodes.some((n) => n.type === "start")) {
                const existing = s.nodes.find((n) => n.type === "start");
                viewport.scrollLeft = Math.max(0, existing.x * zoom - 30);
                viewport.scrollTop = Math.max(0, existing.y * zoom - 30);
                log.textContent =
                  "В истории уже есть «Начать». Выберите его или удалите перед добавлением нового.";
                return;
              }
              s.nodes.push(
                makeNode(
                  type,
                  Math.max(30, viewport.scrollLeft / zoom + 100),
                  Math.max(30, viewport.scrollTop / zoom + 100),
                ),
              );
              change();
              render();
            },
          },
          "+ " + name,
        ),
      );
    }
    left.append(
      el(
        "p",
        { class: "hint" },
        "Тело повтора должно завершаться блоком «Вернуться». Основная цепочка — блоком «Завершить». Ответы диалога имеют отдельные выходы.",
      ),
    );
    for (const n of s.nodes) {
      const [name, color] = types[n.type];
      const c = card(n.id, name, color, n.x, n.y),
        header = c.firstChild;
      header.append(
        button("×", () => {
          s.nodes = s.nodes.filter((v) => v !== n);
          s.edges = s.edges.filter((e) => e.from !== n.id && e.to !== n.id);
          change();
          render();
        }),
      );
      const input = el(
        "button",
        {
          class: "port input-port",
          "aria-label": "Вход " + name,
          title: "Вход: нажмите после выхода другого блока",
        },
        "",
      );
      input.onclick = () => connect(n.id);
      if (n.type !== "start") c.append(input);
      const d = n.data;
      if (n.type === "say" || n.type === "dialogue")
        field(c, "Что он скажет?", "textarea", d.text, (v) => (d.text = v));
      if (n.type === "random")
        field(
          c,
          "Фразы (по одной в строке)",
          "textarea",
          d.phrases.join("\n"),
          (v) => (d.phrases = v.split("\n")),
        );
      if (["say", "random", "wait", "follow", "wander", "stop"].includes(n.type))
        field(c, "Секунд", "number", d.seconds ?? 3, (v) => (d.seconds = v), 0.1, 120, 0.5);
      if (n.type === "repeat")
        field(c, "Число повторов", "number", d.times, (v) => (d.times = v), 1, 10, 1);
      if (n.type === "dialogue") {
        field(
          c,
          "Ответы игрока (до 6 строк)",
          "textarea",
          d.choices.map((q) => q.text).join("\n"),
          (v) => {
            const texts = v.split("\n").slice(0, 6);
            d.choices = texts.map((text, i) => ({ id: d.choices[i]?.id || uid(), text }));
            s.edges = s.edges.filter(
              (e) => e.from !== n.id || d.choices.some((q) => e.port === "choice:" + q.id),
            );
            renderPorts(c, n);
            requestAnimationFrame(drawEdges);
          },
        );
      }
      const targets = { player: "Игрок", monster: "Монстр" };
      if (n.type === "move") {
        field(c, "Ориентир", LANDMARKS, d.landmark, (v) => (d.landmark = v));
        field(c, "Радиус поиска, блоки", "number", d.range, (v) => (d.range = v), 1, 24, 1);
        field(c, "Время на путь, с", "number", d.seconds, (v) => (d.seconds = v), 1, 60, 1);
        c.append(
          el(
            "p",
            { class: "node-note" },
            "Ищет ближайший блок этого типа по горизонтали и ±4 блока по высоте. Нужен свободный наземный проход.",
          ),
        );
      }
      if (n.type === "has_item") {
        field(c, "Предмет", Object.fromEntries(ITEMS), d.item, (v) => (d.item = v));
        field(c, "Количество", "number", d.count, (v) => (d.count = v), 1, 64, 1);
        c.append(
          el("p", { class: "node-note" }, "Проверяет инвентарь игрока, не забирая предметы."),
        );
      }
      if (n.type === "chance")
        field(c, "Вероятность «Да», %", "number", d.percent, (v) => (d.percent = v), 0, 100, 1);
      if (n.type === "heal") {
        field(c, "Кого лечить", targets, d.target, (v) => (d.target = v));
        field(c, "Восстановить HP", "number", d.amount, (v) => (d.amount = v), 1, 100, 1);
      }
      if (n.type === "effect") {
        field(c, "На кого", targets, d.target, (v) => (d.target = v));
        field(c, "Эффект", EFFECTS, d.effect, (v) => (d.effect = v));
        field(c, "Секунд", "number", d.seconds, (v) => (d.seconds = v), 1, 60, 1);
        field(c, "Усиление (0 = I)", "number", d.amplifier, (v) => (d.amplifier = v), 0, 2, 1);
      }
      if (n.type === "sound") {
        field(c, "Звук", SOUNDS, d.sound, (v) => (d.sound = v));
        field(c, "Громкость", "number", d.volume, (v) => (d.volume = v), 0, 1, 0.1);
        field(c, "Высота тона", "number", d.pitch, (v) => (d.pitch = v), 0.5, 2, 0.1);
      }
      if (n.type === "title") {
        field(c, "Заголовок", "textarea", d.text, (v) => (d.text = v));
        field(c, "Подзаголовок", "textarea", d.subtitle, (v) => (d.subtitle = v));
      }
      if (n.type === "trade")
        c.append(
          el(
            "p",
            { class: "node-note" },
            "Открывает настроенный обмен за еду или торговлю NPC. Награда выбирается игроком. Без настроек обмена — выход «не удалось».",
          ),
        );
      if (n.type === "stop")
        c.append(
          el(
            "p",
            { class: "node-note" },
            "Останавливает движение на указанное время. После конца истории восстанавливается обычное поведение.",
          ),
        );
      if (n.type === "look")
        c.append(
          el("p", { class: "node-note" }, "Поворачивает монстра лицом к игроку в этот момент."),
        );
      if (n.type === "start") c.append(el("p", { class: "node-note" }, "Запуск из меню персонажа"));
      if (n.type === "end") c.append(el("p", { class: "node-note" }, "История завершена"));
      if (n.type === "return") c.append(el("p", { class: "node-note" }, "К следующему повторению"));
      if (n.type === "follow" || n.type === "wander")
        c.append(el("p", { class: "node-note" }, "Наземное движение через AI Bedrock"));
      renderPorts(c, n);
    }
  }
  function renderPorts(card, n) {
    card.querySelector(".outputs")?.remove();
    const outs = el("div", { class: "outputs" });
    for (const [key, text] of ports(n)) {
      const b = el(
        "button",
        {
          class: "port output-port",
          "data-port": key,
          "aria-label": "Выход " + text,
          title: "Начать соединение",
        },
        "",
      );
      b.onclick = () => {
        pending = { from: n.id, port: key };
        log.textContent = "Теперь нажмите вход нужного блока слева.";
      };
      outs.append(el("div", {}, el("span", {}, text), b));
    }
    card.append(outs);
  }
  function connect(to) {
    if (!pending || pending.from === to) return;
    const s = story();
    if (!s) return;
    s.edges = s.edges.filter((e) => !(e.from === pending.from && e.port === pending.port));
    s.edges.push({ ...pending, to });
    change();
    drawEdges();
  }
  function drawEdges() {
    svg.replaceChildren();
    const rect = surface.getBoundingClientRect(),
      nodes = [...surface.querySelectorAll(".flow-node")],
      find = (id) => nodes.find((n) => n.dataset.node === id);
    function point(node, right, port) {
      const e = port
        ? [...node.querySelectorAll("[data-port]")].find((e) => e.dataset.port === port)
        : right
          ? null
          : node.querySelector(".input-port");
      const r = (e || node).getBoundingClientRect();
      return {
        x: ((e ? r.x + r.width / 2 : right ? r.right : r.left) - rect.left) / zoom,
        y: ((e ? r.y + r.height / 2 : r.y + 60) - rect.top) / zoom,
      };
    }
    const edges = story()?.edges || [];
    for (const edge of edges) {
      const a = find(edge.from),
        b = find(edge.to);
      if (!a || !b) continue;
      const p = point(a, true, edge.port),
        q = point(b, false),
        path = document.createElementNS(svg.namespaceURI, "path");
      const dx = Math.max(70, Math.abs(p.x - q.x) * 0.5);
      path.setAttribute("d", `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`);
      path.setAttribute("class", edge.parameter ? "parameter-edge" : "story-edge");
      if (!edge.parameter) {
        path.onclick = () => {
          story().edges = story().edges.filter((e) => e !== edge);
          change();
          drawEdges();
        };
        path.setAttribute("tabindex", "0");
        path.setAttribute("aria-label", "Удалить связь");
        path.onkeydown = (e) => {
          if (e.key === "Delete" || e.key === "Enter") path.onclick();
        };
      }
      svg.append(path);
    }
  }
  async function simulate() {
    const s = story();
    if (!s) return;
    log.textContent = "Симуляция: выберите ответ в журнале ниже.";
    const token = ++simToken,
      lines = [];
    const write = (t) => {
      lines.push(t);
      log.textContent = lines.slice(-12).join("\n");
      log.scrollTop = log.scrollHeight;
    };
    async function pick(text, options) {
      if (token !== simToken) throw Error("Симуляция остановлена");
      const box = el("div", { class: "sim-choices" }, el("strong", {}, text));
      const result = await new Promise((resolve) => {
        options.forEach(([id, label]) => box.append(button(label, () => resolve(id))));
        log.append(box);
        log.scrollTop = log.scrollHeight;
        box.querySelector("button")?.focus({ preventScroll: true });
        const timer = setInterval(() => {
          if (token !== simToken) {
            clearInterval(timer);
            resolve(undefined);
          }
        }, 100);
        box.cleanup = () => clearInterval(timer);
      });
      box.cleanup();
      box.remove();
      if (result === undefined) throw Error("Симуляция остановлена");
      return result;
    }
    try {
      await runStory(s, {
        cancelled: () => token !== simToken,
        step: async (n) => {
          surface.querySelectorAll(".running").forEach((e) => e.classList.remove("running"));
          surface.querySelector(`[data-node="${n.id}"]`)?.classList.add("running");
          await new Promise((r) => setTimeout(r, 80));
        },
        say: (t) => write("Герой: " + t),
        wait: async (s) => {
          write(`Ожидание: ${s} с (ускорено)`);
          await new Promise((r) => setTimeout(r, 80));
        },
        motion: async (m) => write("Движение: " + m),
        choose: async (text, choices) => {
          const id = await pick(
            text,
            choices.map((q) => [q.id, q.text]),
          );
          write("Игрок: " + choices.find((q) => q.id === id).text);
          return id;
        },
        action: async (type, d) => {
          write("Действие: " + types[type][0]);
          if (["trade", "move", "has_item"].includes(type)) {
            const labels = ports({ type, data: d });
            const id = await pick("Выберите результат для проверки ветки:", labels);
            write("Проверка: " + labels.find((q) => q[0] === id)[1]);
            return id === "yes";
          }
          return undefined;
        },
      });
      write("Симуляция завершена. Игровые действия показаны условно, время ускорено.");
    } catch (e) {
      write(e.message);
    } finally {
      surface.querySelectorAll(".running").forEach((e) => e.classList.remove("running"));
    }
  }
  new ResizeObserver(drawEdges).observe(viewport);
  return { render };
}
