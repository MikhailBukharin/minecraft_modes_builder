import { world, system } from "@minecraft/server";
import { admitBatch, restoreRates } from "./population-guard.js";

export function installPopulationGuard(config) {
  const s = config.population;
  if (!s.guard) return;
  const pending = new Map(),
    property = config.population_key || "workshop:spawn_rates";
  let rates,
    blocked = false,
    scheduled = false;
  const describe = (e) => ({
    id: e.id,
    dimension: e.dimension.id,
    x: e.location.x,
    z: e.location.z,
  });
  // An after-event is used: rejected newcomers are removed without death, loot or XP.
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    try {
      if (entity.typeId !== config.identifier || cause === "Loaded") return;
      if (pending.size >= 128 || blocked) {
        entity.remove();
        return;
      }
      pending.set(entity.id, entity);
      if (!scheduled) {
        scheduled = true;
        system.run(process);
      }
    } catch {}
  });
  function process() {
    scheduled = false;
    if (!pending.size) return;
    const batch = [...pending.values()];
    pending.clear();
    try {
      if (!rates) rates = restoreRates(world.getDynamicProperty(property));
      const current = [],
        arrivals = [],
        refs = new Map();
      for (const e of batch) {
        try {
          arrivals.push(describe(e));
          refs.set(e.id, e);
        } catch {}
      }
      for (const name of ["overworld", "nether", "the_end"])
        for (const e of world.getDimension(name).getEntities({ type: config.identifier })) {
          if (!refs.has(e.id)) current.push(describe(e));
        }
      const result = admitBatch(current, arrivals, s, world.getAbsoluteTime(), rates);
      world.setDynamicProperty(property, JSON.stringify([...result.rates]));
      rates = result.rates;
      for (const d of result.decisions) {
        try {
          if (!d.allow) refs.get(d.id).remove();
        } catch {}
      }
    } catch (e) {
      // Fail closed for NEW arrivals; never sweep or kill the existing population.
      blocked = true;
      for (const entity of batch) {
        try {
          entity.remove();
        } catch {}
      }
      console.warn(
        "Мастерская: новые появления остановлены после ошибки контроля численности: " + e.message,
      );
    }
  }
}
