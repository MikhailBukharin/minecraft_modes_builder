// Bedrock adapters are supplied by runtime; this module can be tested without Minecraft.
export function createStoryActions({ player, entity, wait, cancelled, motion, trade }) {
  return async function action(type, d) {
    if (cancelled()) throw Error("Сценарий прерван");
    if (type === "stop") return motion("wait");
    if (type === "look") {
      const a = entity.location,
        b = player.location,
        dx = b.x - a.x,
        dz = b.z - a.z,
        dy = b.y - a.y;
      entity.setRotation({
        x: (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
        y: (-Math.atan2(dx, dz) * 180) / Math.PI,
      });
      return;
    }
    if (type === "move") {
      try {
        // Each search range is baked into its native AI group. No teleport or marker entities.
        entity.triggerEvent(`workshop:move_${d.landmark}_${d.range}`);
        // Entity properties are applied on the following tick; discard a prior arrival.
        await wait(0.05);
        for (let t = 0; t < d.seconds; t += 0.25) {
          if (cancelled()) throw Error("Сценарий прерван");
          if (entity.getProperty("workshop:arrived") === true) return true;
          await wait(Math.min(0.25, d.seconds - t));
        }
        return entity.getProperty("workshop:arrived") === true;
      } finally {
        motion("wait");
      }
    }
    if (type === "trade") return trade();
    if (type === "has_item") {
      const inventory = player.getComponent("minecraft:inventory")?.container;
      if (!inventory) throw Error("Инвентарь недоступен");
      let count = 0;
      for (let i = 0; i < inventory.size; i++) {
        const stack = inventory.getItem(i);
        if (stack?.typeId === d.item) count += stack.amount;
      }
      return count >= d.count;
    }
    if (type === "heal") {
      const health = (d.target === "player" ? player : entity).getComponent("minecraft:health");
      if (!health || health.currentValue <= 0) throw Error("Нельзя лечить погибшего персонажа");
      health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + d.amount));
      return;
    }
    if (type === "effect") {
      (d.target === "player" ? player : entity).addEffect(d.effect, Math.ceil(d.seconds * 20), {
        amplifier: d.amplifier,
        showParticles: true,
      });
      return;
    }
    if (type === "sound") {
      player.playSound(d.sound, { volume: d.volume, pitch: d.pitch });
      return;
    }
    if (type === "title") {
      player.onScreenDisplay.setTitle(d.text, {
        subtitle: d.subtitle,
        fadeInDuration: 10,
        stayDuration: 60,
        fadeOutDuration: 20,
      });
      return;
    }
    throw Error("Неизвестное действие: " + type);
  };
}
