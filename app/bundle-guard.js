// Shared ceiling for NEW instances of all creature types in a collection.
// Existing/reloaded entities remain intact, including worlds already above the ceiling.
import { world, system } from "@minecraft/server";
export function installBundleGuard(identifiers, maximum) {
  const types = new Set(identifiers),
    pending = new Map();
  let scheduled = false,
    blocked = false;
  world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    try {
      if (!types.has(entity.typeId) || cause === "Loaded") return;
      if (blocked || pending.size >= 256) {
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
    const batch = [...pending.values()];
    pending.clear();
    try {
      const arrivals = [];
      for (const e of batch) {
        try {
          if (types.has(e.typeId)) arrivals.push(e);
        } catch {}
      }
      const newcomers = new Set(arrivals.map((e) => e.id));
      let total = 0;
      for (const name of ["overworld", "nether", "the_end"])
        for (const e of world.getDimension(name).getEntities({ families: ["workshop_monster"] })) {
          if (types.has(e.typeId) && !newcomers.has(e.id)) total++;
        }
      for (const e of arrivals) {
        try {
          if (total >= maximum) e.remove();
          else total++;
        } catch {}
      }
    } catch (error) {
      blocked = true;
      for (const e of batch) {
        try {
          e.remove();
        } catch {}
      }
      console.warn(
        "Общая сборка: новые появления остановлены после ошибки контроля численности: " +
          error.message,
      );
    }
  }
}
