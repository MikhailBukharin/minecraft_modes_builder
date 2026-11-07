import { ask } from "./ask.js";
export function mountGeneration(host, api) {
  let provider = null,
    job = null,
    candidate = null,
    pollTimer = null,
    instructions = "",
    consent = false,
    restoredFor = null;
  const make = (tag, text = "", cls = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  function button(text, fn) {
    const e = make("button", text);
    e.onclick = fn;
    return e;
  }
  function render() {
    host.replaceChildren();
    host.className = "generation-panel";
    host.append(
      make("span", "CODEX + ТВОЙ РИСУНОК", "eyebrow"),
      make("h3", "Сгенерировать 3D-модель"),
    );
    host.append(
      make(
        "p",
        "Codex получает рисунок, описание и истории этого проекта. Результат — редактируемая кубическая модель и палитра цветов.",
        "hint",
      ),
    );
    const note = make(
      "p",
      provider?.available
        ? "Codex найден · используется существующий вход через ChatGPT. Запрос расходует лимиты Codex."
        : provider
          ? "Codex CLI не найден. Установите Codex и выполните codex login."
          : "Проверяю подключение Codex…",
      "hint",
    );
    host.append(note);
    const label = make("label", "Что сохранить или уточнить во внешности?"),
      text = make("textarea");
    text.rows = 3;
    text.maxLength = 6000;
    text.disabled = !!job && ["queued", "running"].includes(job.status);
    text.placeholder = "Например: три глаза, длинная шея, четыре лапы. Сохрани силуэт рисунка.";
    text.value = instructions;
    text.oninput = () => (instructions = text.value);
    label.append(text);
    host.append(label);
    const confirm = make("label", "", "check"),
      check = make("input");
    check.type = "checkbox";
    check.checked = consent;
    check.disabled = !!job && ["queued", "running"].includes(job.status);
    check.onchange = () => (consent = check.checked);
    confirm.append(
      check,
      document.createTextNode(
        "Передать рисунок, описание и истории в OpenAI через локальный Codex",
      ),
    );
    host.append(confirm);
    const busy = job && ["queued", "running"].includes(job.status),
      start = button(busy ? "Генерация модели…" : "✦ Сгенерировать через Codex", generate);
    start.className = "primary";
    start.disabled = busy || !provider?.available;
    host.append(start);
    if (busy)
      host.append(
        button("Отменить генерацию", async () => {
          try {
            job = await api.request("/api/generation/cancel", { id: job.id });
            clearTimeout(pollTimer);
            render();
          } catch (e) {
            api.error(e.message);
          }
        }),
      );
    if (job) {
      const message = make(
        "p",
        job.message,
        "generation-status" + (job.status === "error" ? " error" : ""),
      );
      message.setAttribute("role", "status");
      host.append(message);
    }
    if (candidate) {
      host.append(
        make("p", `${candidate.bones} костей · ${candidate.cubes} кубов`, "generation-counts"),
        make("p", candidate.summary, "hint"),
      );
      const same = job.project_id === api.getProject().id;
      if (same) {
        host.append(
          button("Предпросмотр результата", () => api.previewCandidate(candidate)),
          button("Применить к проекту", apply),
        );
      } else
        host.append(
          make(
            "p",
            "Результат относится к другому проекту. Откройте исходный проект, чтобы применить модель.",
            "hint",
          ),
        );
    }
    host.append(
      make(
        "p",
        "Модель не заменяется автоматически. Этот запрос создаёт отдельный запуск Codex и не читает историю текущего чата. После применения можно уточнить кости и кубы в редакторе.",
        "hint",
      ),
    );
  }
  async function generate() {
    try {
      if (!consent) throw Error("Отметьте согласие на передачу рисунка и описания в Codex.");
      candidate = null;
      job = await api.request("/api/generation/start", {
        project: api.readProject(),
        instructions,
        consent: true,
      });
      render();
      poll();
    } catch (e) {
      api.error(e.message);
    }
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (!job) return;
    try {
      const result = await api.request("/api/generation/jobs/" + job.id);
      job = result;
      if (result.candidate) candidate = result.candidate;
      render();
      if (["queued", "running"].includes(job.status)) pollTimer = setTimeout(poll, 1800);
    } catch (e) {
      job = { ...job, status: "error", message: e.message };
      render();
    }
  }
  async function apply() {
    if (!candidate || job.project_id !== api.getProject().id) return;
    if (
      !(await ask(
        "Применить сгенерированную геометрию и текстуру? Текущая модель будет сохранена в локальной резервной копии.",
      ))
    )
      return;
    try {
      await api.apply(candidate, { id: job.id, provider: "Codex CLI", summary: candidate.summary });
      api.error("Модель применена. Проверьте внешний вид и сохраните проект.", false);
    } catch (e) {
      api.error(e.message);
    }
  }
  api
    .request("/api/generation/provider")
    .then((p) => {
      provider = p;
      render();
    })
    .catch((e) => {
      provider = { available: false };
      render();
      api.error(e.message);
    });
  async function refresh() {
    const id = api.getProject()?.id;
    if (!id || id === restoredFor) return render();
    restoredFor = id;
    clearTimeout(pollTimer);
    job = null;
    candidate = null;
    render();
    try {
      const result = await api.request("/api/generation/latest/" + id);
      if (api.getProject()?.id !== id) return;
      if (result) {
        job = result;
        candidate = result.candidate || null;
        if (["queued", "running"].includes(job.status)) poll();
      }
      render();
    } catch (e) {
      api.error(e.message);
    }
  }
  return { render, refresh };
}
