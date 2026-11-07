// Shared by the editor simulator and exported Bedrock runtime. No eval or commands.
export async function runStory(story, io) {
  const nodes = new Map(story.nodes.map((n) => [n.id, n]));
  const edges = new Map(story.edges.map((e) => [e.from + ":" + (e.port || "next"), e.to]));
  const start = story.nodes.find((n) => n.type === "start");
  let budget = 2000;
  async function path(id, depth = 0) {
    if (depth > 8) throw Error("Слишком много вложенных повторов");
    while (id) {
      if (--budget < 0) throw Error("Превышен лимит 2000 шагов");
      if (io.cancelled()) throw Error("Сценарий прерван");
      const n = nodes.get(id);
      if (!n) throw Error("Блок не найден");
      const d = n.data || {};
      await io.step?.(n);
      if (io.cancelled()) throw Error("Сценарий прерван");
      let port = "next";
      if (n.type === "end") return "end";
      if (n.type === "return") return "return";
      if (n.type === "say" || n.type === "random") {
        const text =
          n.type === "say"
            ? d.text
            : d.phrases[Math.floor((io.random?.() ?? Math.random()) * d.phrases.length)];
        await io.say(text);
        await io.wait(d.seconds || 2);
      } else if (n.type === "wait") await io.wait(d.seconds);
      else if (n.type === "follow" || n.type === "wander") {
        await io.motion(n.type);
        try {
          await io.wait(d.seconds);
        } finally {
          await io.motion("wait");
        }
      } else if (n.type === "dialogue") {
        const choice = await io.choose(d.text, d.choices);
        if (choice === undefined || choice === null) throw Error("Диалог закрыт");
        port = "choice:" + choice;
      } else if (n.type === "repeat") {
        for (let i = 0; i < d.times; i++) {
          const result = await path(edges.get(n.id + ":body"), depth + 1);
          if (result !== "return") throw Error("Тело повтора должно заканчиваться «Вернуться»");
        }
      } else if (n.type === "chance")
        port = (io.random?.() ?? Math.random()) * 100 < d.percent ? "yes" : "no";
      else if (
        ["trade", "move", "has_item", "stop", "look", "heal", "effect", "sound", "title"].includes(
          n.type,
        )
      ) {
        if (!io.action) throw Error("Действие недоступно: " + n.type);
        const result = await io.action(n.type, d);
        if (n.type === "stop") await io.wait(d.seconds ?? 3);
        if (["trade", "move", "has_item"].includes(n.type)) port = result ? "yes" : "no";
      } else if (n.type !== "start") throw Error("Неизвестный блок: " + n.type);
      const next = edges.get(n.id + ":" + port);
      if (!next) throw Error("Не подключён выход " + port);
      id = next;
    }
    throw Error("Незавершённый сценарий");
  }
  if (!start) throw Error("Нет начала");
  return path(start.id);
}
