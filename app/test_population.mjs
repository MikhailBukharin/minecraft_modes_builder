import assert from "node:assert/strict";
import fs from "node:fs";
import { admitBatch, cellKey, restoreRates } from "./web/population-guard.js";
const settings = {
  guard: true,
  area_size: 64,
  area_max: 4,
  period_seconds: 60,
  period_max: 2,
  loaded_max: 20,
};
const mob = (id, x = 1, z = 1, dimension = "minecraft:overworld") => ({ id, x, z, dimension });
let result = admitBatch(
  [],
  Array.from({ length: 8 }, (_, i) => mob(String(i))),
  settings,
  0,
);
assert.equal(result.decisions.filter((d) => d.allow).length, 2);
assert.ok(result.decisions.slice(2).every((d) => d.reason === "rate"));
let rates = restoreRates(JSON.stringify([...result.rates]));
assert.equal(admitBatch([], [mob("late")], settings, 1199, rates).decisions[0].reason, "rate");
assert.equal(admitBatch([], [mob("later")], settings, 1200, rates).decisions[0].allow, true);
assert.equal(
  admitBatch([mob("old1"), mob("old2"), mob("old3"), mob("old4")], [mob("new")], settings, 2000)
    .decisions[0].reason,
  "area",
);
assert.equal(
  admitBatch(
    [mob("old", 1, 1, "minecraft:nether")],
    [mob("new", 200, 200)],
    { ...settings, loaded_max: 1 },
    0,
  ).decisions[0].reason,
  "total",
);
result = admitBatch(
  [],
  Array.from({ length: 10 }, (_, i) => mob(String(i), i * 64)),
  { ...settings, loaded_max: 3 },
  0,
);
assert.equal(result.decisions.filter((d) => d.allow).length, 3);
assert.notEqual(cellKey(mob("a", -1), 64), cellKey(mob("b", 0), 64));
assert.notEqual(cellKey(mob("a"), 64), cellKey(mob("a"), 128));
assert.notEqual(cellKey(mob("a"), 64), cellKey(mob("a", 1, 1, "minecraft:nether"), 64));
result = admitBatch(
  [],
  Array.from({ length: 6 }, (_, i) => mob(String(i), i % 2 ? 63 : 64)),
  settings,
  0,
);
assert.equal(result.decisions.filter((d) => d.allow).length, 4); // Adjacent cells have independent quotas.
rates = new Map(Array.from({ length: 128 }, (_, i) => ["other" + i, [0]]));
assert.equal(admitBatch([], [mob("new")], settings, 1, rates).decisions[0].reason, "budget");
assert.equal(admitBatch([], [mob("new")], settings, 1200, rates).decisions[0].allow, true);
rates = new Map([[cellKey(mob("x"), 64), [5000, 5001]]]);
assert.equal(admitBatch([], [mob("new")], settings, 1, rates).decisions[0].reason, "rate");
for (const raw of [undefined, "bad", "{}", '[["a",[-1]]]', "x".repeat(28001)])
  assert.equal(restoreRates(raw).size, 0);

// Exercise actual event wiring with a small engine double; no Minecraft process required.
const source = fs
  .readFileSync(new URL("./population-runtime.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "")

  .replace("export function installPopulationGuard", "function installPopulationGuard");
function runtime(s = settings, prior = []) {
  const entities = [...prior],
    jobs = [],
    properties = new Map();
  let subscriber,
    scans = 0,
    fail = false;
  const world = {
    afterEvents: { entitySpawn: { subscribe: (fn) => (subscriber = fn) } },
    getDynamicProperty: (k) => properties.get(k),
    setDynamicProperty: (k, v) => properties.set(k, v),
    getAbsoluteTime: () => 0,
    getDimension: (name) => ({
      getEntities: () => {
        scans++;
        if (fail) throw Error("scan failure");
        return entities.filter((e) => !e.removed && e.dimension.id === "minecraft:" + name);
      },
    }),
  };
  const system = { run: (fn) => jobs.push(fn) };
  const install = new Function(
    "world",
    "system",
    "admitBatch",
    "restoreRates",
    "console",
    source + ";return installPopulationGuard;",
  )(world, system, admitBatch, restoreRates, { warn: () => {} });
  install({ identifier: "my:test", population: s });
  return {
    entities,
    jobs,
    properties,
    spawn(e, cause = "Spawned") {
      entities.push(e);
      subscriber({ entity: e, cause });
    },
    flush() {
      while (jobs.length) jobs.shift()();
    },
    get scans() {
      return scans;
    },
    fail() {
      fail = true;
    },
  };
}
function actor(id, x = 1, dimension = "minecraft:overworld") {
  const properties = new Map();
  return {
    id,
    typeId: "my:test",
    location: { x, z: 1 },
    dimension: { id: dimension },
    removed: false,
    getDynamicProperty: (k) => properties.get(k),
    setDynamicProperty: (k, v) => properties.set(k, v),
    remove() {
      this.removed = true;
    },
    kill() {
      throw Error("Guard must never kill");
    },
  };
}
let game = runtime();
for (let i = 0; i < 130; i++) game.spawn(actor(String(i)));
assert.equal(game.jobs.length, 1);
assert.equal(game.entities.filter((e) => e.removed).length, 2);
game.flush();
assert.equal(game.scans, 3);
assert.equal(game.entities.filter((e) => !e.removed).length, 2);
assert.equal(restoreRates(game.properties.get("workshop:spawn_rates")).size, 1);
game = runtime();
for (let i = 0; i < 25; i++) game.spawn(actor("old" + i), "Loaded");
assert.equal(game.jobs.length, 0);
const newcomer = actor("new", 200);
game.spawn(newcomer);
game.flush();
assert.equal(newcomer.removed, true);
assert.ok(game.entities.slice(0, 25).every((e) => !e.removed));
game = runtime();
const existing = actor("old");
game.spawn(existing, "Loaded");
game.fail();
const bad = actor("bad");
game.spawn(bad);
game.flush();
assert.equal(bad.removed, true);
assert.equal(existing.removed, false);
const blocked = actor("blocked");
game.spawn(blocked);
assert.equal(blocked.removed, true);
console.log(
  "Population guard: area, rolling rate, total across dimensions, persistence, negative coordinates, bounded memory, burst batching, reload protection and failure handling passed.",
);
