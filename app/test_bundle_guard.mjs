import assert from "node:assert/strict";
import fs from "node:fs";
import { admitBatch, restoreRates } from "./web/population-guard.js";
const source = fs
  .readFileSync(new URL("./bundle-guard.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replace("export function installBundleGuard", "function installBundleGuard");
const perType = fs
  .readFileSync(new URL("./population-runtime.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replace("export function installPopulationGuard", "function installPopulationGuard");
const settings = {
  guard: true,
  loaded_max: 20,
  area_size: 64,
  area_max: 4,
  period_seconds: 60,
  period_max: 2,
};
function game(maximum = 3, withTypes = false) {
  const actors = [],
    handlers = [],
    jobs = [],
    properties = new Map();
  let fail = false,
    scans = 0;
  const world = {
    afterEvents: { entitySpawn: { subscribe: (f) => handlers.push(f) } },
    getDynamicProperty: (k) => properties.get(k),
    setDynamicProperty: (k, v) => properties.set(k, v),
    getAbsoluteTime: () => 0,
    getDimension: (name) => ({
      getEntities: (query) => {
        scans++;
        if (fail) throw Error("scan failed");
        return actors.filter(
          (a) =>
            !a.removed &&
            a.dimension.id === "minecraft:" + name &&
            (!query.type || query.type === a.typeId),
        );
      },
    }),
  };
  const system = { run: (f) => jobs.push(f) },
    log = { warn: () => {} };
  if (withTypes) {
    const install = new Function(
      "world",
      "system",
      "admitBatch",
      "restoreRates",
      "console",
      perType + ";return installPopulationGuard",
    )(world, system, admitBatch, restoreRates, log);
    install({
      identifier: "my:first",
      population: settings,
      population_key: "workshop:rates_first",
    });
    install({
      identifier: "my:second",
      population: settings,
      population_key: "workshop:rates_second",
    });
  }
  new Function("world", "system", "console", source + ";return installBundleGuard")(
    world,
    system,
    log,
  )(["my:first", "my:second"], maximum);
  return {
    actors,
    properties,
    jobs,
    get scans() {
      return scans;
    },
    fail() {
      fail = true;
    },
    spawn(id, type = "my:first", cause = "Spawned", dimension = "minecraft:overworld") {
      const a = {
        id,
        removed: false,
        get typeId() {
          if (this.removed) throw Error("invalid entity");
          return type;
        },
        location: { x: 1, z: 1 },
        dimension: { id: dimension },
        remove() {
          this.removed = true;
        },
        kill() {
          throw Error("must never kill");
        },
      };
      actors.push(a);
      for (const handler of handlers) handler({ entity: a, cause });
      return a;
    },
    flush() {
      while (jobs.length) jobs.shift()();
    },
  };
}
let g = game(3);
g.spawn("a", "my:first");
g.spawn("b", "my:second");
g.spawn("c", "my:first");
g.spawn("d", "my:second");
assert.equal(g.jobs.length, 1);
g.flush();
assert.equal(g.actors.filter((a) => !a.removed).length, 3);
assert.equal(g.scans, 3);
g = game(1);
const old = g.spawn("old", "my:first", "Loaded", "minecraft:nether");
const fresh = g.spawn("fresh", "my:second");
g.flush();
assert.ok(!old.removed && fresh.removed);
g = game(1);
for (let i = 0; i < 3; i++) g.spawn("old" + i, "my:first", "Loaded");
const extra = g.spawn("new", "my:second");
g.flush();
assert.equal(extra.removed, true);
assert.equal(g.actors.filter((a) => !a.removed).length, 3);
g = game(3, true);
for (let i = 0; i < 4; i++) {
  g.spawn("a" + i, "my:first");
  g.spawn("b" + i, "my:second");
}
g.flush();
assert.equal(g.actors.filter((a) => !a.removed).length, 3);
assert.ok(g.properties.has("workshop:rates_first") && g.properties.has("workshop:rates_second"));
g = game(3);
const keep = g.spawn("old", "my:first", "Loaded");
g.fail();
const denied = g.spawn("new");
g.flush();
assert.equal(denied.removed, true);
assert.equal(keep.removed, false);
assert.equal(g.spawn("later").removed, true);
g = game(200);
for (let i = 0; i < 300; i++) g.spawn(String(i));
assert.equal(g.jobs.length, 1);
g.flush();
assert.equal(g.actors.filter((a) => !a.removed).length, 200);
console.log(
  "Bundle guard: shared ceiling, dimensions, batching, reloaded actors, per-type counters, overflow and failure cleanup passed.",
);
