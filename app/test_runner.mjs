import assert from "node:assert/strict";
import { runStory } from "./web/story-runner.js";
const n = (id, type, data = {}) => ({ id, type, data }),
  e = (from, to, port = "next") => ({ from, to, port });
const story = {
  nodes: [
    n("s", "start"),
    n("r", "repeat", { times: 3 }),
    n("q", "dialogue", {
      text: "Вопрос",
      choices: [
        { id: "yes", text: "Да" },
        { id: "no", text: "Нет" },
      ],
    }),
    n("a", "say", { text: "Да", seconds: 1 }),
    n("b", "say", { text: "Нет", seconds: 1 }),
    n("ret", "return"),
    n("end", "end"),
  ],
  edges: [
    e("s", "r"),
    e("r", "q", "body"),
    e("q", "a", "choice:yes"),
    e("q", "b", "choice:no"),
    e("a", "ret"),
    e("b", "ret"),
    e("r", "end"),
  ],
};
let said = [],
  waited = [];
const io = {
  cancelled: () => false,
  say: async (t) => said.push(t),
  wait: async (t) => waited.push(t),
  choose: async () => "no",
  motion: async () => {},
};
assert.equal(await runStory(story, io), "end");
assert.deepEqual(said, ["Нет", "Нет", "Нет"]);
assert.deepEqual(waited, [1, 1, 1]);
await assert.rejects(() => runStory(story, { ...io, cancelled: () => true }), /прерван/);
await assert.rejects(() => runStory(story, { ...io, choose: async () => undefined }), /закрыт/);
const broken = structuredClone(story);
broken.edges = broken.edges.filter((e) => e.from !== "r" || e.port !== "body");
await assert.rejects(() => runStory(broken, io), /Незавершённый/);
const endless = {
  nodes: [n("s", "start"), n("w", "wait", { seconds: 0.1 })],
  edges: [e("s", "w"), e("w", "w")],
};
await assert.rejects(() => runStory(endless, io), /2000/);
const moves = [];
const walk = {
  nodes: [n("s", "start"), n("f", "follow", { seconds: 1 }), n("e", "end")],
  edges: [e("s", "f"), e("f", "e")],
};
await runStory(walk, { ...io, motion: async (m) => moves.push(m) });
assert.deepEqual(moves, ["follow", "wait"]);
console.log(
  "Story runner: branches, repeats, cancellation, missing edges, budget, motion cleanup passed.",
);
