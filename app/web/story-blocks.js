// Shared editor defaults and port labels. Bedrock actions use the same node data.
export const LANDMARKS = {
  campfire: "Костёр",
  bell: "Колокол",
  chest: "Сундук",
  crafting_table: "Верстак",
};
export const EFFECTS = {
  regeneration: "Регенерация",
  speed: "Скорость",
  resistance: "Сопротивление",
  fire_resistance: "Огнестойкость",
  night_vision: "Ночное зрение",
};
export const SOUNDS = {
  "random.levelup": "Повышение уровня",
  "random.orb": "Сфера опыта",
  "note.bell": "Колокольчик",
  "random.pop": "Хлопок",
};
export const types = {
  start: ["Начать", "green"],
  say: ["Сказать", "purple"],
  random: ["Выбрать реплику", "pink"],
  dialogue: ["Диалог с ответами", "purple"],
  trade: ["Открыть торговлю", "gold"],
  move: ["Идти к ориентиру", "blue"],
  stop: ["Стоять на месте", "blue"],
  look: ["Посмотреть на игрока", "blue"],
  has_item: ["Проверить предмет", "pink"],
  chance: ["Случайная развилка", "pink"],
  heal: ["Восстановить здоровье", "green"],
  effect: ["Наложить эффект", "green"],
  sound: ["Проиграть звук", "purple"],
  title: ["Сообщение на экране", "purple"],
  wait: ["Подождать", "gold"],
  follow: ["Следовать за игроком", "blue"],
  wander: ["Гулять рядом", "green"],
  repeat: ["Повторить", "gold"],
  end: ["Завершить", "green"],
  return: ["Вернуться из повтора", "gold"],
};
export const uid = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);
export function data(type) {
  return (
    {
      say: { text: "Привет, путешественник!", seconds: 2 },
      random: { phrases: ["Привет!", "Рад тебя видеть!"], seconds: 2 },
      dialogue: {
        text: "Пойдём на прогулку?",
        choices: [
          { id: uid(), text: "Да, пойдём" },
          { id: uid(), text: "Лучше подождём" },
        ],
      },
      repeat: { times: 3 },
      stop: { seconds: 10 },
      wait: { seconds: 3 },
      follow: { seconds: 3 },
      wander: { seconds: 3 },
      move: { landmark: "campfire", range: 12, seconds: 20 },
      has_item: { item: "minecraft:bread", count: 1 },
      chance: { percent: 50 },
      heal: { target: "player", amount: 4 },
      effect: { target: "player", effect: "regeneration", seconds: 5, amplifier: 0 },
      sound: { sound: "random.levelup", volume: 0.5, pitch: 1 },
      title: { text: "Новое приключение", subtitle: "Поговорите с персонажем" },
    }[type] || {}
  );
}
export function makeNode(type, x, y, override = {}) {
  return { id: uid(), type, x, y, data: { ...data(type), ...override } };
}
export function ports(n) {
  return n.type === "repeat"
    ? [
        ["body", "Тело повтора"],
        ["next", "Дальше"],
      ]
    : n.type === "dialogue"
      ? n.data.choices.map((q) => ["choice:" + q.id, q.text || "Ответ"])
      : ["trade", "move", "has_item", "chance"].includes(n.type)
        ? [
            [
              "yes",
              { trade: "Обмен совершён", move: "Прибыл", has_item: "Есть", chance: "Да" }[n.type],
            ],
            [
              "no",
              {
                trade: "Отмена / не удалось",
                move: "Путь не найден",
                has_item: "Нет",
                chance: "Нет",
              }[n.type],
            ],
          ]
        : ["end", "return"].includes(n.type)
          ? []
          : [["next", "Дальше"]];
}
