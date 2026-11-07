const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
};
export function mountBundle(host, api) {
  let state,
    available = [],
    report = null,
    busy = false,
    loaded = false;
  const title = el("input", { "aria-label": "Название общего мода", maxlength: "80" }),
    limit = el("input", {
      "aria-label": "Общий лимит персонажей",
      type: "number",
      min: "1",
      max: "200",
      value: "40",
    }),
    saved = el("select", { "aria-label": "Сохранённые общие моды" }),
    rows = el("div", { class: "bundle-sources" }),
    result = el("div", { class: "bundle-report", role: "status" }),
    message = el("p", { class: "hint", role: "status" });
  const download = el("a", { class: "download", hidden: "" }, "↓ Скачать общий .mcaddon"),
    reportDownload = el("a", { hidden: "" }, "Скачать отчёт о согласованности");
  const check = el("button", { class: "primary", onclick: checkAll }, "Проверить совместимость"),
    build = el("button", { onclick: exportAll, disabled: "" }, "Собрать общий мод"),
    refresh = el("button", { onclick: () => reloadSources().catch(error) }, "Обновить список"),
    fresh = el(
      "button",
      {
        onclick: async () => {
          try {
            setBusy(true);
            state = await api.request("/api/bundle/new");
            bind();
            renderRows();
            invalidate();
            saved.value = "";
          } catch (e) {
            error(e);
          } finally {
            setBusy(false);
          }
        },
      },
      "Новая общая сборка",
    );
  const upload = el("input", {
    type: "file",
    accept: ".mcaddon",
    multiple: "",
    "aria-label": "Добавить индивидуальные файлы модов",
  });
  title.oninput = () => {
    state.name = title.value;
    invalidate();
  };
  limit.oninput = () => {
    state.loaded_max = Number(limit.value);
    invalidate();
  };
  saved.onchange = async () => {
    if (!saved.value) return;
    try {
      setBusy(true);
      invalidate();
      state = await api.request("/api/bundle/" + saved.value);
      await reloadSources();
      bind();
      renderRows();
      invalidate();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  };
  upload.onchange = async () => {
    try {
      setBusy(true);
      let count = 0;
      for (const file of upload.files) {
        if (file.size > 12 * 1024 * 1024) throw Error("Каждый файл должен быть не более 12 МБ.");
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result.split(",")[1]);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const source = await api.request("/api/bundle/import", { name: file.name, data });
        available.push(source);
        state.selection.push({ kind: source.kind, id: source.id, identifier: source.identifier });
        count++;
      }
      invalidate();
      renderRows();
      message.textContent = `Добавлено файлов: ${count}. Проверьте ID и совместимость.`;
    } catch (e) {
      invalidate();
      renderRows();
      error(e);
    } finally {
      upload.value = "";
      setBusy(false);
    }
  };
  const nameLabel = el("label", {}, "Название общей сборки", title),
    limitLabel = el("label", {}, "Максимум загруженных персонажей всех выбранных типов", limit);
  host.append(
    el("span", { class: "eyebrow" }, "ФИНАЛЬНАЯ СБОРКА"),
    el("h2", {}, "Собери общий мир"),
    el(
      "p",
      {},
      "Объедините 2–12 индивидуальных модов в одно дополнение с общим пакетом поведения и ресурсов. Выберите сохранённые проекты или добавьте .mcaddon, созданные этой мастерской.",
    ),
    el("div", { class: "bundle-top" }, el("label", {}, "Открыть сохранённую сборку", saved), fresh),
    el("div", { class: "pair" }, nameLabel, limitLabel),
    el(
      "p",
      { class: "hint" },
      "Общий лимит действует на новые появления, включая яйца и команды. Уже существующие и повторно загруженные персонажи сохраняются. Индивидуальные ограничения каждого типа тоже действуют.",
    ),
    el(
      "div",
      { class: "bundle-toolbar" },
      refresh,
      el("label", { class: "upload" }, "＋ Добавить файлы .mcaddon", upload),
    ),
    el(
      "p",
      { class: "hint" },
      "Состав берётся из сохранённых версий проектов. Перед добавлением текущего персонажа сохраните его. ID можно изменить только для общей сборки; исходный проект останется прежним.",
    ),
    rows,
    el("div", { class: "bundle-toolbar" }, check, build),
    message,
    result,
    download,
    reportDownload,
    el(
      "p",
      { class: "hint" },
      "После импорта включите общий BP и RP в тестовом мире. Выключите индивидуальные пакеты, содержащие тех же персонажей. Игровая проверка в Bedrock остаётся обязательным последним действием.",
    ),
  );
  function error(e) {
    message.textContent = e.message;
    message.classList.add("error");
  }
  function setBusy(value) {
    busy = value;
    for (const e of [title, limit, saved, upload, check, refresh, fresh]) e.disabled = value;
    if (value) rows.querySelectorAll("input").forEach((e) => (e.disabled = true));
    else if (state) renderRows();
    build.disabled = value || !report?.ok;
  }
  function invalidate() {
    report = null;
    result.replaceChildren();
    download.hidden = true;
    reportDownload.hidden = true;
    build.disabled = true;
    message.textContent = "Состав изменён. Выполните проверку совместимости.";
    message.classList.remove("error");
  }
  function bind() {
    title.value = state.name;
    limit.value = state.loaded_max;
  }
  function selection(source) {
    return state.selection.find((r) => r.id === source.id && r.kind === source.kind);
  }
  function renderRows() {
    rows.replaceChildren();
    const table = el(
        "table",
        {},
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...["Включить", "Персонаж / источник", "ID в общем моде"].map((t) => el("th", {}, t)),
          ),
        ),
      ),
      body = el("tbody");
    for (const source of available) {
      const chosen = selection(source),
        select = el("input", { type: "checkbox", "aria-label": "Включить: " + source.name }),
        id = el("input", {
          "aria-label": "ID в сборке: " + source.name,
          value: chosen?.identifier || source.identifier || "",
          spellcheck: "false",
        });
      select.checked = !!chosen;
      select.disabled = !!source.error;
      id.disabled = !chosen || !!source.error;
      select.dataset.invalid = source.error ? "true" : "false";
      select.onchange = () => {
        if (select.checked)
          state.selection.push({ kind: source.kind, id: source.id, identifier: id.value });
        else
          state.selection = state.selection.filter(
            (r) => !(r.kind === source.kind && r.id === source.id),
          );
        id.disabled = !select.checked;
        invalidate();
      };
      id.oninput = () => {
        const row = selection(source);
        if (row) row.identifier = id.value.trim();
        invalidate();
      };
      body.append(
        el(
          "tr",
          {},
          el("td", {}, select),
          el(
            "td",
            {},
            el("strong", {}, source.name),
            el(
              "small",
              {},
              source.error ||
                (source.kind === "project" ? "Сохранённый проект" : "Файл .mcaddon") +
                  ` · ${source.cubes} кубов · ${source.identifier}`,
            ),
          ),
          el("td", {}, id),
        ),
      );
    }
    for (const chosen of state.selection)
      if (!available.some((s) => s.id === chosen.id && s.kind === chosen.kind))
        body.append(
          el(
            "tr",
            {},
            el("td", {}, "!"),
            el("td", {}, "Источник больше не найден: " + chosen.id),
            el(
              "td",
              {},
              el(
                "button",
                {
                  onclick: () => {
                    state.selection = state.selection.filter((r) => r !== chosen);
                    invalidate();
                    renderRows();
                  },
                },
                "Убрать из сборки",
              ),
            ),
          ),
        );
    table.append(body);
    rows.append(table);
    if (!available.length)
      rows.append(
        el("p", {}, "Сохраните двух персонажей или добавьте готовые индивидуальные файлы."),
      );
  }
  function showReport(r) {
    result.replaceChildren(
      el("h3", {}, r.ok ? "Совместимость проверена" : "Нужно устранить конфликты"),
    );
    for (const text of r.errors) result.append(el("p", { class: "error" }, "• " + text));
    if (r.ok) {
      result.append(
        el(
          "p",
          {},
          `${r.monsters.length} персонажей · ${r.total_cubes} кубов · Общий предел: ${r.loaded_max} · Bedrock ${r.engine.join(".")} · API ${r.script_api}`,
        ),
      );
      const list = el("ul");
      for (const m of r.monsters) list.append(el("li", {}, m.name + " → " + m.identifier));
      result.append(
        list,
        el(
          "p",
          {},
          "Проверены ID, пути ресурсов, модели, текстуры, анимации, сценарии и ссылки на награды. Счётчики появления разных типов разделены.",
        ),
      );
    }
    for (const text of r.warnings) result.append(el("p", { class: "hint" }, text));
  }
  async function reloadSources() {
    available = await api.request("/api/bundle/sources");
    if (state) renderRows();
    if (report) invalidate();
  }
  async function listSaved() {
    const list = await api.request("/api/bundles");
    saved.replaceChildren(
      new Option("Выберите общую сборку…", ""),
      ...list.map((s) => new Option(s.name + " · 1.0." + s.version, s.id)),
    );
    saved.value = state?.version ? state.id : "";
  }
  async function checkAll() {
    try {
      setBusy(true);
      message.textContent = "Проверяю состав и ссылки…";
      report = await api.request("/api/bundle/check", state);
      showReport(report);
      message.textContent = report.ok
        ? "Можно собрать общий мод."
        : "Исправьте отмеченные конфликты и повторите проверку.";
      message.classList.remove("error");
    } catch (e) {
      invalidate();
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function exportAll() {
    if (!report?.ok) return;
    try {
      setBusy(true);
      message.textContent = "Собираю общий мод…";
      const response = await api.request("/api/bundle/export", {
        ...state,
        snapshot: report.snapshot,
      });
      state = response.bundle;
      report = response.report;
      showReport(report);
      download.href = response.url;
      download.hidden = false;
      download.download = "";
      reportDownload.href = response.report_url;
      reportDownload.hidden = false;
      reportDownload.download = "";
      await listSaved();
      message.textContent = `Общий мод 1.0.${state.version} сохранён. Внутри один BP и один RP.`;
    } catch (e) {
      invalidate();
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function refreshAll() {
    if (busy) return;
    setBusy(true);
    try {
      if (!loaded) {
        state = await api.request("/api/bundle/new");
        bind();
        loaded = true;
      }
      await reloadSources();
      await listSaved();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return { refresh: refreshAll };
}
