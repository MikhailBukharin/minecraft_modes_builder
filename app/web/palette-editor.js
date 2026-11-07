export function mountPalette(host, api) {
  function render() {
    host.replaceChildren();
    const p = api.getProject();
    if (!p?.model_palette) return;
    const title = document.createElement("h3");
    title.textContent = "Палитра модели";
    host.append(title);
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent =
      "Цвет тела и цвет лап связаны с палитрой. Остальные оттенки, глаза и гребень можно изменить здесь.";
    host.append(note);
    const grid = document.createElement("div");
    grid.className = "palette-grid";
    host.append(grid);
    p.model_palette.forEach((color, i) => {
      const label = document.createElement("label");
      label.textContent =
        p.palette_roles.body === i
          ? "Тело"
          : p.palette_roles.accent === i
            ? "Лапы и акценты"
            : "Цвет " + (i + 1);
      const input = document.createElement("input");
      input.type = "color";
      input.value = color;
      input.setAttribute("aria-label", "Палитра: " + label.textContent);
      input.oninput = () => {
        p.model_palette[i] = input.value;
        if (i === p.palette_roles.body) api.sync("color", input.value);
        if (i === p.palette_roles.accent) api.sync("accent", input.value);
        api.changed();
      };
      label.append(input);
      grid.append(label);
    });
  }
  return { render };
}
