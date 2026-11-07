export const BIOMES = {
  forest: "Лес",
  plains: "Равнина",
  desert: "Пустыня",
  taiga: "Тайга",
  jungle: "Джунгли",
  swamp: "Болото",
  mountain: "Горы",
};
export function biomeChoices(selected, onchange, disabled = false) {
  const group = document.createElement("fieldset");
  group.className = "biome-choices";
  const legend = document.createElement("legend");
  legend.textContent = "Биомы появления (один или несколько)";
  group.append(legend);
  for (const [key, text] of Object.entries(BIOMES)) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.includes(key);
    input.disabled = disabled;
    input.value = key;
    input.setAttribute("aria-label", "Биом: " + text);
    input.onchange = () =>
      onchange([...group.querySelectorAll("input:checked")].map((i) => i.value));
    label.append(input, document.createTextNode(text));
    group.append(label);
  }
  return group;
}
