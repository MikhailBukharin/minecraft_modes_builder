import { ITEMS, FOODS } from "./items.js";
import { renderNpcEditor } from "./npc-editor.js";
const make = (tag, text = "", cls = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);
export function mountRewards(host, api) {
  let npcCatalog = null;
  api
    .loadNpcCatalog()
    .then((c) => {
      npcCatalog = c;
      render();
    })
    .catch(() => {});
  function render() {
    host.replaceChildren();
    const p = api.getProject();
    if (!p) return;
    const r = p.rewards;
    const modeLabel = make("label", "Режим обмена"),
      mode = make("select");
    mode.append(
      new Option("Монстр: еда в обмен на предметы", "food"),
      new Option("NPC: случайный запрос и награда на выбор", "npc"),
    );
    mode.value = r.trade_mode;
    mode.onchange = () => {
      r.trade_mode = mode.value;
      api.changed();
      render();
    };
    modeLabel.append(mode);
    host.append(modeLabel);
    const number = (parent, label, value, set, min, max) => {
      const wrap = make("label", label),
        input = make("input");
      input.type = "number";
      input.min = min;
      input.max = max;
      input.step = 1;
      input.value = value;
      input.oninput = () => {
        set(Number(input.value));
        api.changed();
      };
      wrap.append(input);
      parent.append(wrap);
      return input;
    };
    function item(parent, label, value, set, food = false) {
      const wrap = make("label", label),
        select = make("select"),
        catalog = food ? FOODS : ITEMS;
      for (const [id, name] of catalog) select.append(new Option(name, id));
      const custom = make("input");
      custom.type = "text";
      custom.maxLength = 122;
      custom.placeholder = "my_items:crystal";
      custom.setAttribute("aria-label", label + ": свой ID");
      if (!food) {
        select.append(new Option("Другой предмет (по ID)…", "custom"));
        custom.value = value;
        custom.hidden = catalog.some((v) => v[0] === value);
      }
      select.value = catalog.some((v) => v[0] === value) ? value : "custom";
      select.onchange = () => {
        custom.hidden = select.value !== "custom";
        if (select.value === "custom") {
          custom.value = value;
          custom.focus();
        } else {
          value = select.value;
          set(value);
          api.changed();
        }
      };
      custom.oninput = () => {
        value = custom.value.trim();
        set(value);
        api.changed();
      };
      wrap.append(select);
      if (!food) wrap.append(custom);
      parent.append(wrap);
    }
    const death = make("section", "", "reward-section");
    death.append(
      make("h3", "После гибели монстра"),
      make(
        "p",
        "Опыт выдаётся за убийство игроком. Каждое правило выпадения проверяется отдельно.",
        "hint",
      ),
    );
    host.append(death);
    number(death, "Опыт за убийство", r.experience, (v) => (r.experience = v), 0, 10000);
    const definitions = [
      ["death", death, "Предметы после гибели", "+ Предмет после гибели"],
      ["timed", null, "Регулярное выпадение", "+ Предмет по таймеру"],
      ["trades", null, "Еда в обмен на предметы", "+ Обмен за еду"],
    ];
    for (const [kind, existing, title, addLabel] of definitions) {
      if (kind === "trades" && r.trade_mode === "npc") {
        const npc = make("section", "", "reward-section npc-editor");
        host.append(npc);
        renderNpcEditor(npc, r.npc_trade, npcCatalog, {
          changed: api.changed,
          rerender: render,
          itemPicker: item,
          reset: (value) => (r.npc_trade = value),
        });
        continue;
      }
      const section = existing || make("section", "", "reward-section");
      if (!existing) {
        section.append(make("h3", title));
        host.append(section);
      }
      if (kind === "timed")
        section.append(
          make(
            "p",
            "Монстр оставляет предметы рядом с собой. Время идёт, пока он жив и загружен в мире. При возвращении накопленной пачки не будет.",
            "hint",
          ),
        );
      if (kind === "trades")
        section.append(
          make(
            "p",
            "Игрок отдаёт еду из инвентаря, монстр выдаёт предметы. Обмен открывается через взаимодействие с монстром.",
            "hint",
          ),
        );
      const rows = make("div", "", "reward-rows");
      section.append(rows);
      r[kind].forEach((row, index) => {
        const card = make("fieldset", "", "reward-row");
        card.dataset.rewardId = row.id;
        card.append(
          make(
            "legend",
            (kind === "trades" ? "Обмен " : kind === "timed" ? "Таймер " : "Добыча ") + (index + 1),
          ),
        );
        rows.append(card);
        if (kind === "trades") {
          item(card, "Еда от игрока", row.food, (v) => (row.food = v), true);
          number(card, "Сколько еды отдать", row.food_count, (v) => (row.food_count = v), 1, 64);
          item(card, "Предмет от монстра", row.item, (v) => (row.item = v));
          number(card, "Сколько предметов получить", row.count, (v) => (row.count = v), 1, 64);
          number(
            card,
            "Пауза между обменами, с",
            row.cooldown,
            (v) => (row.cooldown = v),
            0,
            86400,
          );
        } else {
          item(card, "Выпадающий предмет", row.item, (v) => (row.item = v));
          const pair = make("div", "", "pair");
          card.append(pair);
          number(pair, "Минимум предметов", row.min, (v) => (row.min = v), 1, 64);
          number(pair, "Максимум предметов", row.max, (v) => (row.max = v), 1, 64);
          number(card, "Вероятность, %", row.chance, (v) => (row.chance = v), 0, 100);
          if (kind === "timed")
            number(card, "Интервал, с", row.seconds, (v) => (row.seconds = v), 1, 86400);
        }
        const remove = make("button", "Убрать правило");
        remove.type = "button";
        remove.onclick = () => {
          r[kind] = r[kind].filter((v) => v !== row);
          api.changed();
          render();
        };
        card.append(remove);
      });
      if (!r[kind].length) section.append(make("p", "Правил пока нет.", "hint"));
      const add = make("button", addLabel);
      add.type = "button";
      add.disabled = r[kind].length >= 16;
      add.onclick = () => {
        r[kind].push(
          kind === "trades"
            ? {
                id: uid(),
                food: "minecraft:apple",
                food_count: 1,
                item: "minecraft:emerald",
                count: 1,
                cooldown: 0,
              }
            : {
                id: uid(),
                item: kind === "timed" ? "minecraft:egg" : "minecraft:blaze_rod",
                min: 1,
                max: 1,
                chance: 100,
                ...(kind === "timed" ? { seconds: 60 } : {}),
              },
        );
        api.changed();
        render();
      };
      section.append(add);
    }
    host.append(
      make(
        "p",
        "При заполненном инвентаре обмен не состоится и предметы останутся у игрока. В NPC-режиме запрос и остаток сделок сохраняются для каждого персонажа. Для своего предмета нужен активный пакет, который его добавляет.",
        "hint",
      ),
    );
  }
  return { render };
}
