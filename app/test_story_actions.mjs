import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStoryActions } from "./web/story-actions.js";
import { runStory } from "./web/story-runner.js";
import { examples } from "./web/story-examples.js";
import { types, ports } from "./web/story-blocks.js";
const stories = examples.map(([, make]) => make());
const validation = spawnSync(
  "python",
  [
    "-c",
    'import json,sys; from stories import validate_stories,NODE_TYPES; x=json.load(sys.stdin); validate_stories(x["stories"],True); assert set(x["types"])==NODE_TYPES',
  ],
  {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    input: JSON.stringify({ stories, types: Object.keys(types) }),
    encoding: "utf8",
  },
);
assert.equal(validation.status, 0, validation.stderr);
for (const s of stories)
  for (const branch of [true, false]) {
    const io = {
      cancelled: () => false,
      wait: async () => {},
      say: async () => {},
      motion: async () => {},
      choose: async (text, choices) => choices[branch ? 0 : choices.length - 1].id,
      action: async () => branch,
      random: () => (branch ? 0 : 0.999),
    };
    assert.equal(await runStory(s, io), "end", s.name);
    for (const n of s.nodes)
      for (const [port] of ports(n))
        assert.ok(s.edges.some((e) => e.from === n.id && e.port === port));
  }
const pause = {
  nodes: [
    { id: "s", type: "start", data: {} },
    { id: "p", type: "stop", data: { seconds: 10 } },
    { id: "e", type: "end", data: {} },
  ],
  edges: [
    { from: "s", to: "p", port: "next" },
    { from: "p", to: "e", port: "next" },
  ],
};
const pauses = [];
await runStory(pause, {
  cancelled: () => false,
  action: async (t) => pauses.push(t),
  wait: async (s) => pauses.push(s),
});
assert.deepEqual(pauses, ["stop", 10]);
let stopped = [],
  events = [],
  cancel = false,
  ticks = 0,
  arrived = false,
  autoArrive = true,
  tradeResult = true;
const health = {
  currentValue: 18,
  effectiveMax: 20,
  setCurrentValue(v) {
    this.currentValue = v;
  },
};
const inv = {
  size: 3,
  getItem: (i) =>
    [{ typeId: "minecraft:bread", amount: 2 }, undefined, { typeId: "minecraft:bread", amount: 3 }][
      i
    ],
};
const calls = [];
const player = {
  location: { x: 10, y: 0, z: 0 },
  getComponent: (id) => (id === "minecraft:health" ? health : { container: inv }),
  addEffect: (...x) => calls.push(x),
  playSound: (...x) => calls.push(x),
  onScreenDisplay: { setTitle: (...x) => calls.push(x) },
};
const entity = {
  location: { x: 0, y: 0, z: 0 },
  triggerEvent: (e) => {
    events.push(e);
    arrived = false;
  },
  getProperty: () => arrived,
  setRotation: (r) => calls.push(r),
  getComponent: () => health,
};
const action = createStoryActions({
  player,
  entity,
  wait: async () => {
    ticks++;
    if (autoArrive && ticks === 3) arrived = true;
  },
  cancelled: () => cancel,
  motion: (m) => stopped.push(m),
  trade: async () => tradeResult,
});
assert.equal(await action("move", { landmark: "campfire", range: 12, seconds: 3 }), true);
assert.deepEqual(events, ["workshop:move_campfire_12"]);
assert.deepEqual(stopped, ["wait"]);
ticks = 0;
autoArrive = false;
assert.equal(await action("move", { landmark: "chest", range: 8, seconds: 1 }), false);
assert.equal(ticks, 5);
assert.equal(stopped.at(-1), "wait");
const interrupt = createStoryActions({
  player,
  entity,
  wait: async () => {
    cancel = true;
  },
  cancelled: () => cancel,
  motion: (m) => stopped.push(m),
});
await assert.rejects(
  () => interrupt("move", { landmark: "campfire", range: 12, seconds: 5 }),
  /прерван/,
);
assert.equal(stopped.at(-1), "wait");
cancel = false;
await action("heal", { target: "player", amount: 10 });
assert.equal(health.currentValue, 20);
health.currentValue = 0;
await assert.rejects(() => action("heal", { target: "player", amount: 1 }), /погибшего/);
health.currentValue = 18;
assert.equal(await action("has_item", { item: "minecraft:bread", count: 5 }), true);
assert.equal(await action("has_item", { item: "minecraft:bread", count: 6 }), false);
assert.equal(inv.getItem(0).amount, 2);
await action("look", {});
assert.equal(calls.at(-1).y, -90);
await action("effect", { target: "player", effect: "speed", seconds: 5, amplifier: 1 });
assert.deepEqual(calls.at(-1), ["speed", 100, { amplifier: 1, showParticles: true }]);
await action("sound", { sound: "random.levelup", volume: 0.5, pitch: 1 });
assert.equal(calls.at(-1)[1].volume, 0.5);
await action("title", { text: "Готово", subtitle: "В путь" });
assert.equal(calls.at(-1)[1].subtitle, "В путь");
assert.equal(await action("trade", {}), true);
tradeResult = false;
assert.equal(await action("trade", {}), false);
// Unknown actions fail closed; they cannot silently advance to a reward.
await assert.rejects(() => action("execute_command", {}), /Неизвестное/);
console.log(
  "Story actions: 7 strict templates, both branches, arrival/timeout/cancel cleanup, health cap, inventory, effects, sound, title, trade passed.",
);
