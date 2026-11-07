import { ITEMS, itemLabel } from "./items.js";
import { getNpcOffer } from "./npc-trade.js";
const make = (tag, text = "", cls = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);
export function renderNpcEditor(host, config, catalog, { changed, rerender, itemPicker, reset }) {
  host.append(
    make("h3", "Торговля человекообразного NPC"),
    make(
      "p",
      "NPC случайно выбирает один запрос из вашего списка. Игрок отдаёт запрошенные предметы и выбирает одну награду из постоянного каталога. Запрос и остаток сделок общие для всех игроков у этого NPC.",
      "hint",
    ),
  );
  if (!catalog) {
    host.append(make("p", "Загружаю каталог наград…", "hint"));
    return;
  }
  function number(parent, label, value, set, min, max) {
    const wrap = make("label", label),
      input = make("input");
    input.type = "number";
    input.min = min;
    input.max = max;
    input.step = 1;
    input.value = value;
    input.oninput = () => {
      set(Number(input.value));
      changed();
    };
    wrap.append(input);
    parent.append(wrap);
  }
  const settings = make("div", "", "pair");
  host.append(settings);
  number(
    settings,
    "Обновлять запрос каждые, с",
    config.refresh_seconds,
    (v) => (config.refresh_seconds = v),
    30,
    86400,
  );
  number(settings, "Сделок до обновления", config.max_uses, (v) => (config.max_uses = v), 1, 64);
  host.append(
    make(
      "p",
      "Повторное открытие меню и вход в мир не меняют запрос. Когда сделки закончатся, NPC ждёт обновления. Одна сделка даёт одну выбранную награду.",
      "hint",
    ),
  );
  const requests = make("section", "", "npc-requests");
  requests.append(make("h4", "Что NPC может попросить"));
  host.append(requests);
  config.requests.forEach((row, index) => {
    const card = make("fieldset", "", "reward-row");
    card.append(make("legend", "Запрос NPC " + (index + 1)));
    requests.append(card);
    itemPicker(card, "Запрашиваемый предмет", row.item, (v) => (row.item = v));
    const pair = make("div", "", "pair");
    card.append(pair);
    number(pair, "Минимальное количество запроса", row.min, (v) => (row.min = v), 1, 64);
    number(pair, "Максимальное количество запроса", row.max, (v) => (row.max = v), 1, 64);
    const remove = make("button", "Убрать запрос");
    remove.onclick = () => {
      config.requests = config.requests.filter((v) => v !== row);
      changed();
      rerender();
    };
    card.append(remove);
  });
  const addRequest = make("button", "+ Возможный запрос NPC");
  addRequest.disabled = config.requests.length >= 16;
  addRequest.onclick = () => {
    const used = new Set(config.requests.map((r) => r.item)),
      item = [
        "minecraft:bone",
        "minecraft:string",
        "minecraft:leather",
        "minecraft:paper",
        ...ITEMS.map((v) => v[0]),
      ].find((id) => !used.has(id));
    config.requests.push({ id: uid(), item, min: 8, max: 16 });
    changed();
    rerender();
  };
  requests.append(addRequest);
  const rewards = make("section", "", "npc-rewards");
  rewards.append(make("h4", "Какие награды выбирает игрок"));
  host.append(rewards);
  config.rewards.forEach((row, index) => {
    const spec = catalog.rewards.find((v) => v.key === row.choice),
      card = make("fieldset", "", "reward-row");
    card.append(make("legend", "Награда NPC " + (index + 1)));
    rewards.append(card);
    const label = make("label", "Выбор редкой награды"),
      select = make("select");
    catalog.rewards.forEach((s) => select.append(new Option(s.label, s.key)));
    select.value = row.choice;
    select.onchange = () => {
      row.choice = select.value;
      row.count = Math.min(row.count, catalog.rewards.find((s) => s.key === row.choice).max_count);
      changed();
      rerender();
    };
    label.append(select);
    card.append(label);
    number(
      card,
      "Количество выбранной награды",
      row.count,
      (v) => (row.count = v),
      1,
      spec?.max_count || 1,
    );
    if (spec?.potion || spec?.enchantment)
      card.append(
        make(
          "p",
          spec.potion
            ? "Настоящее зелье с указанным эффектом."
            : "Зачарованная книга с указанным зачарованием и уровнем.",
          "hint",
        ),
      );
    const remove = make("button", "Убрать награду");
    remove.onclick = () => {
      config.rewards = config.rewards.filter((v) => v !== row);
      changed();
      rerender();
    };
    card.append(remove);
  });
  const addReward = make("button", "+ Награда на выбор игрока");
  addReward.disabled = config.rewards.length >= 16;
  addReward.onclick = () => {
    const next = catalog.rewards.find((s) => !config.rewards.some((r) => r.choice === s.key));
    if (!next) return;
    config.rewards.push({ id: uid(), choice: next.key, count: 1 });
    changed();
    rerender();
  };
  rewards.append(addReward);
  const buttons = make("div", "", "model-toolbar"),
    preset = make("button", "Пример коллекционера"),
    previewButton = make("button", "Показать пример торговли"),
    preview = make("div", "", "npc-preview");
  preset.onclick = () => {
    reset(JSON.parse(JSON.stringify(catalog.defaults)));
    changed();
    rerender();
  };
  previewButton.onclick = () => {
    preview.replaceChildren();
    try {
      const offer = getNpcOffer(config, null, 0),
        request = config.requests.find((r) => r.id === offer.request_id);
      preview.append(make("h4", "Пример запроса: " + itemLabel(request.item) + " ×" + offer.count));
      const label = make("label", "Игрок выбирает награду"),
        select = make("select"),
        receipt = make("p");
      config.rewards.forEach((r) =>
        select.append(
          new Option(catalog.rewards.find((s) => s.key === r.choice).label + " ×" + r.count, r.id),
        ),
      );
      function update() {
        const r = config.rewards.find((r) => r.id === select.value),
          s = catalog.rewards.find((s) => s.key === r.choice);
        receipt.textContent = `Отдать: ${itemLabel(request.item)} ×${offer.count}. Получить: ${s.label} ×${r.count}.`;
      }
      select.onchange = update;
      label.append(select);
      preview.append(
        label,
        receipt,
        make("p", "Это пример в редакторе. Предложения в игровом мире он не изменяет.", "hint"),
      );
      update();
    } catch (e) {
      preview.append(make("p", e.message, "error"));
    }
  };
  buttons.append(preset, previewButton);
  host.append(buttons, preview);
}
