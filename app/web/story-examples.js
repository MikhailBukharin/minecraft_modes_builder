import { makeNode, uid } from "./story-blocks.js";
function graph(name, spec, links) {
  const nodes = spec.map(([type, data, x, y], i) =>
    makeNode(type, x ?? 60 + (i % 5) * 290, y ?? 80 + Math.floor(i / 5) * 420, data),
  );
  return {
    id: uid(),
    name,
    nodes,
    edges: links.map(([a, b, port = "next"]) => ({ from: nodes[a].id, to: nodes[b].id, port })),
  };
}
export function sampleStory() {
  return graph(
    "Маленькая история",
    [
      ["start"],
      ["say"],
      ["repeat"],
      ["say", { text: "Прогулка закончилась!" }],
      ["end"],
      ["random", {}, 650, 440],
      ["wait", {}, 940, 440],
      ["return", {}, 1230, 440],
    ],
    [
      [0, 1],
      [1, 2],
      [2, 5, "body"],
      [5, 6],
      [6, 7],
      [2, 3],
      [3, 4],
    ],
  );
}
export function dialogueStory() {
  return graph(
    "Диалог с героем",
    [
      ["start", {}, 50, 240],
      [
        "dialogue",
        {
          text: "Пойдём на прогулку?",
          choices: [
            { id: "yes", text: "Да, пойдём" },
            { id: "no", text: "Лучше подождём" },
          ],
        },
        340,
        200,
      ],
      ["follow", {}, 650, 70],
      ["wait", {}, 650, 460],
      ["say", { text: "Спасибо за прогулку!" }, 940, 70],
      ["end", {}, 1240, 240],
    ],
    [
      [0, 1],
      [1, 2, "choice:yes"],
      [1, 3, "choice:no"],
      [2, 4],
      [4, 5],
      [3, 5],
    ],
  );
}
function tradeStory() {
  return graph(
    "Торговец: выбрать награду",
    [
      ["start", {}, 30, 240],
      [
        "dialogue",
        {
          text: "Хочешь посмотреть мои товары?",
          choices: [
            { id: "yes", text: "Покажи товары" },
            { id: "no", text: "В другой раз" },
          ],
        },
        310,
        200,
      ],
      ["trade", {}, 600, 150],
      ["say", { text: "Спасибо за обмен!" }, 900, 50],
      ["say", { text: "Возвращайся, когда будешь готов." }, 900, 480],
      ["end", {}, 1200, 240],
    ],
    [
      [0, 1],
      [1, 2, "choice:yes"],
      [1, 4, "choice:no"],
      [2, 3, "yes"],
      [2, 4, "no"],
      [3, 5],
      [4, 5],
    ],
  );
}
function moveStory() {
  return graph(
    "Приказ: иди к костру",
    [
      ["start", {}, 30, 240],
      [
        "dialogue",
        {
          text: "Куда мне отправиться?",
          choices: [
            { id: "go", text: "Иди к ближайшему костру" },
            { id: "stay", text: "Стой здесь" },
          ],
        },
        310,
        180,
      ],
      ["move", {}, 610, 70],
      ["stop", {}, 610, 500],
      ["say", { text: "Я у костра. Что дальше?" }, 920, 50],
      ["say", { text: "Не могу дойти. Проверь ориентир и проход." }, 920, 470],
      ["end", {}, 1230, 260],
    ],
    [
      [0, 1],
      [1, 2, "choice:go"],
      [1, 3, "choice:stay"],
      [3, 6],
      [2, 4, "yes"],
      [2, 5, "no"],
      [4, 6],
      [5, 6],
    ],
  );
}
function healerStory() {
  return graph(
    "Целитель: помощь герою",
    [
      ["start"],
      ["look"],
      [
        "dialogue",
        {
          text: "Тебе нужна помощь?",
          choices: [
            { id: "yes", text: "Восстанови моё здоровье" },
            { id: "no", text: "Спасибо, всё хорошо" },
          ],
        },
      ],
      ["heal"],
      ["effect"],
      ["sound", {}, 930, 480],
      ["title", { text: "Помощь целителя", subtitle: "Получена помощь" }, 640, 480],
      ["say", { text: "Береги себя!" }, 350, 480],
      ["end", {}, 60, 480],
    ],
    [
      [0, 1],
      [1, 2],
      [2, 3, "choice:yes"],
      [2, 7, "choice:no"],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
    ],
  );
}
function itemStory() {
  return graph(
    "Диалог: есть ли хлеб?",
    [
      ["start", {}, 30, 250],
      ["has_item", {}, 320, 180],
      ["say", { text: "Вижу, ты взял еду. Готов к походу?" }, 640, 60],
      ["say", { text: "Советую взять хлеб в дорогу." }, 640, 470],
      ["end", {}, 970, 250],
    ],
    [
      [0, 1],
      [1, 2, "yes"],
      [1, 3, "no"],
      [2, 4],
      [3, 4],
    ],
  );
}
function rumorStory() {
  return graph(
    "Слухи у костра",
    [
      ["start", {}, 30, 250],
      ["chance", {}, 320, 200],
      ["say", { text: "Говорят, в горах спрятан клад." }, 640, 70],
      ["say", { text: "В лесу видели необычного зверя." }, 640, 460],
      ["end", {}, 970, 250],
    ],
    [
      [0, 1],
      [1, 2, "yes"],
      [1, 3, "no"],
      [2, 4],
      [3, 4],
    ],
  );
}
export const examples = [
  ["Повтор и реплики", sampleStory],
  ["Разговор и прогулка", dialogueStory],
  ["Торговля", tradeStory],
  ["Приказ идти к костру", moveStory],
  ["Помощь целителя", healerStory],
  ["Проверка предмета", itemStory],
  ["Случайные слухи", rumorStory],
];
