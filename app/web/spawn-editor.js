const make = (tag, text = "", cls = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
export function mountSpawnEditor(host, api) {
  let reportTicket = 0;
  function render() {
    host.replaceChildren();
    const p = api.getProject();
    if (!p) return;
    const s = p.population,
      natural = p.spawn === "natural";
    const native = make("section", "", "reward-section");
    host.append(native);
    native.append(
      make("h3", "Естественное появление"),
      make(
        "p",
        "Частота Bedrock — относительный вес среди подходящих существ, а не число мобов в минуту. Итог зависит также от биомов, света, игроков и общих лимитов игры.",
        "hint",
      ),
    );
    const number = (parent, label, key, min, max, disabled = false) => {
      const wrap = make("label", label),
        input = make("input");
      input.type = "number";
      input.value = s[key];
      input.min = min;
      input.max = max;
      input.step = 1;
      input.disabled = disabled;
      input.oninput = () => {
        s[key] = Number(input.value);
        api.changed();
      };
      wrap.append(input);
      parent.append(wrap);
    };
    number(native, "Относительная частота, 1–100", "weight", 1, 100, !natural);
    number(native, "Штатный лимит плотности на поверхности", "native_density", 1, 64, !natural);
    const pair = make("div", "", "pair");
    native.append(pair);
    number(pair, "Минимум в группе", "herd_min", 1, 8, !natural);
    number(pair, "Максимум в группе", "herd_max", 1, 8, !natural);
    if (!natural)
      native.append(
        make("p", "Для этих четырёх настроек включите естественное появление выше.", "hint"),
      );
    const strict = make("section", "", "reward-section");
    host.append(strict);
    strict.append(make("h3", "Защита от накопления"));
    const checkLabel = make("label", "", "check"),
      check = make("input");
    check.type = "checkbox";
    check.checked = s.guard;
    check.onchange = () => {
      s.guard = check.checked;
      api.changed();
      render();
    };
    checkLabel.append(check, document.createTextNode("Строгие лимиты для новых монстров"));
    strict.append(checkLabel);
    strict.append(
      make(
        "p",
        "Контролируются все новые экземпляры этого типа: естественные, из яиц, команд и скриптов. Лишние новые существа убираются без убийства. Уже существующие и повторно загруженные сохраняются.",
        "hint",
      ),
    );
    const sizeLabel = make("label", "Размер ячейки площади"),
      select = make("select");
    for (const side of [32, 64, 128, 256])
      select.append(new Option(`${side} × ${side} блоков`, side));
    select.value = s.area_size;
    select.disabled = !s.guard;
    select.onchange = () => {
      s.area_size = Number(select.value);
      api.changed();
    };
    sizeLabel.append(select);
    strict.append(sizeLabel);
    number(strict, "Максимум в одной ячейке", "area_max", 1, 64, !s.guard);
    const rate = make("div", "", "pair");
    strict.append(rate);
    number(rate, "Новых появлений за период на ячейку", "period_max", 1, 16, !s.guard);
    number(rate, "Период, секунд", "period_seconds", 5, 3600, !s.guard);
    number(strict, "Порог общего числа загруженных монстров", "loaded_max", 1, 200, !s.guard);
    strict.append(
      make(
        "p",
        "Ячейки образуют сетку по X/Z; учитывается вся высота. Общий порог суммирует три измерения. Когда порог достигнут, новые появления отклоняются. Перемещение и загрузка старых монстров могут временно превысить порог.",
        "hint",
      ),
    );
    const defaults = make("button", "Применить спокойные настройки");
    defaults.onclick = () => {
      Object.assign(s, {
        weight: 10,
        herd_min: 1,
        herd_max: 2,
        native_density: 4,
        guard: true,
        area_size: 64,
        area_max: 4,
        period_seconds: 60,
        period_max: 2,
        loaded_max: 20,
      });
      api.changed();
      render();
    };
    strict.append(defaults);
    const review = make("section", "", "reward-section");
    review.append(make("h3", "Проверка нагрузки"));
    const button = make("button", "Проверить модель и настройки"),
      result = make("div", "", "guardrail-result");
    button.onclick = async () => {
      const ticket = ++reportTicket;
      button.disabled = true;
      try {
        const r = await api.report();
        if (ticket !== reportTicket || !host.contains(result)) return;
        result.replaceChildren();
        result.append(
          make("p", `${r.bones} костей · ${r.cubes} кубов · текстура ${r.texture.join("×")}`),
        );
        result.append(
          make(
            "p",
            `При заданном общем пороге: до ${r.projected_cubes} кубов моделей. Верхний средний темп добычи: ${r.timed_items_per_minute} предметов/мин на моба, ${r.loaded_timed_items_per_minute} при заданном числе мобов.`,
            "hint",
          ),
        );
        if (r.warnings.length) {
          const list = make("ul");
          r.warnings.forEach((t) => list.append(make("li", t)));
          result.append(list);
        } else
          result.append(
            make(
              "p",
              "По этим ориентирам явных превышений нет. Проверьте нагрузку в тестовом мире.",
            ),
          );
      } catch (e) {
        result.replaceChildren(make("p", e.message, "error"));
      } finally {
        button.disabled = false;
      }
    };
    review.append(
      button,
      result,
      make(
        "p",
        "Стартовые ориентиры для обычного моба: 30–100 кубов, 8–24 кости, текстура 64–256 пикселей по стороне, 10–20 загруженных экземпляров и небольшая дальность поиска цели. Это рекомендации мастерской, а не пределы Minecraft.",
        "hint",
      ),
    );
    host.append(review);
  }
  return { render };
}
