import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { config } from "./config.js";
import { runStory } from "./story-runner.js";
import { createStoryActions } from "./story-actions.js";
import { planTrade, commitTrade, tickDrops } from "./economy.js";
import { itemLabel } from "./items.js";
import { installPopulationGuard } from "./population-runtime.js";
import { npcTradeMenu } from "./npc-trade-runtime.js";
installPopulationGuard(config);

const locks = new Set(),
  sessions = new Map();
const OWNER = "workshop:owner",
  MODE = "workshop:mode";
function nearby(player, entity) {
  try {
    return (
      player.dimension.id === entity.dimension.id &&
      Math.hypot(
        player.location.x - entity.location.x,
        player.location.y - entity.location.y,
        player.location.z - entity.location.z,
      ) < 32
    );
  } catch {
    return false;
  }
}
function own(player, entity) {
  const owner = entity.getDynamicProperty(OWNER);
  if (owner && owner !== player.id)
    throw Error("Движением этого персонажа управляет другой игрок.");
  entity.setDynamicProperty(OWNER, player.id);
}
function motion(player, entity, mode, persistent = false) {
  own(player, entity);
  if (mode === "follow") {
    const t = entity.getComponent("minecraft:tameable");
    if (!t || (!t.isTamed && !t.tame(player))) throw Error("Не удалось назначить владельца");
    if (t.tamedToPlayerId !== player.id) throw Error("Другой владелец персонажа");
  }
  entity.triggerEvent("workshop:" + mode);
  if (persistent) entity.setDynamicProperty(MODE, mode);
}
async function play(player, entity, story) {
  own(player, entity);
  if (sessions.has(entity.id)) throw Error("Сценарий уже выполняется");
  const token = { cancel: false };
  sessions.set(entity.id, token);
  let checks = 0;
  const cancelled = () => token.cancel || !nearby(player, entity) || ++checks > 30000;
  const wait = async (seconds) => {
    for (let ticks = Math.ceil(seconds * 20); ticks > 0; ticks -= Math.min(ticks, 10)) {
      if (cancelled()) throw Error("Сценарий остановлен: игрок или персонаж недоступен");
      await new Promise((r) => system.runTimeout(r, Math.min(ticks, 10)));
    }
  };
  try {
    entity.setDynamicProperty(MODE, "default");
    motion(player, entity, "wait");
    const action = createStoryActions({
      player,
      entity,
      wait,
      cancelled,
      motion: (mode) => motion(player, entity, mode),
      trade: async () => {
        if (locks.has(entity.id)) return false;
        locks.add(entity.id);
        try {
          if (config.rewards.trade_mode === "npc")
            return await npcTradeMenu(player, entity, config);
          if (config.rewards.trades.length) return await tradeMenu(player, entity);
          player.sendMessage("Для этой истории сначала настройте обмен в мастерской.");
          return false;
        } catch (e) {
          player.sendMessage("Обмен: " + e.message);
          return false;
        } finally {
          locks.delete(entity.id);
        }
      },
    });
    await runStory(story, {
      cancelled,
      wait,
      action,
      say: (text) => player.sendMessage(config.name + ": " + text),
      motion: (mode) => motion(player, entity, mode),
      choose: async (text, choices) => {
        const form = new ActionFormData().title(config.name).body(text);
        choices.forEach((q) => form.button(q.text));
        const r = await form.show(player);
        return r.canceled ? undefined : choices[r.selection]?.id;
      },
    });
  } finally {
    sessions.delete(entity.id);
    try {
      entity.triggerEvent("workshop:default");
      entity.setDynamicProperty(MODE, "default");
    } catch {}
  }
}
async function tradeMenu(player, entity) {
  const trades = config.rewards.trades,
    form = new ActionFormData()
      .title("Еда в обмен на предметы")
      .body("Еда берётся из вашего инвентаря. Награда поступит туда же.");
  trades.forEach((t) =>
    form.button(`${itemLabel(t.food)} ×${t.food_count} → ${itemLabel(t.item)} ×${t.count}`),
  );
  const result = await form.show(player);
  if (result.canceled || !nearby(player, entity)) return;
  if (
    Math.hypot(
      player.location.x - entity.location.x,
      player.location.y - entity.location.y,
      player.location.z - entity.location.z,
    ) > 6
  )
    throw Error("Подойдите ближе к персонажу.");
  const trade = trades[result.selection];
  if (!trade) return;
  if (entity.getComponent("minecraft:health")?.currentValue <= 0)
    throw Error("Этот персонаж уже погиб.");
  const key = "workshop:trade_" + trade.id,
    now = world.getAbsoluteTime(),
    last = entity.getDynamicProperty(key);
  if (typeof last === "number" && now >= last && now - last < trade.cooldown * 20)
    throw Error("Этот обмен пока отдыхает. Попробуйте позже.");
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) throw Error("Инвентарь недоступен.");
  const plan = planTrade(container, trade, (id) => new ItemStack(id, 1));
  commitTrade(container, plan);
  entity.setDynamicProperty(key, now);
  player.sendMessage(`${config.name}: получено ${itemLabel(trade.item)} ×${trade.count}.`);
  return true;
}
async function menu(player, entity) {
  if (locks.has(entity.id)) return;
  locks.add(entity.id);
  try {
    const running = sessions.has(entity.id);
    if (running) {
      const r = await new ActionFormData()
        .title(config.name)
        .body("История выполняется.")
        .button("Остановить историю")
        .show(player);
      if (!r.canceled && nearby(player, entity)) {
        own(player, entity);
        const t = sessions.get(entity.id);
        if (t) t.cancel = true;
      }
      return;
    }
    const form = new ActionFormData()
        .title(config.name)
        .body(running ? "История выполняется. Можно остановить её." : config.description),
      actions = [];
    function action(title, run) {
      form.button(title);
      actions.push(run);
    }
    if (config.interactions || config.stories.length) {
      ["Следуй за мной", "Жди здесь", "Гуляй"].forEach((title, i) =>
        action(title, () => {
          if (sessions.has(entity.id)) throw Error("Сначала остановите текущую историю.");
          motion(player, entity, ["follow", "wait", "wander"][i], true);
        }),
      );
      action("Остановить историю", () => {
        own(player, entity);
        const t = sessions.get(entity.id);
        if (t) t.cancel = true;
        else motion(player, entity, "default", true);
      });
    }
    config.stories.forEach((s) =>
      action("История: " + s.name, () => {
        if (sessions.has(entity.id)) throw Error("Сначала остановите текущую историю.");
        play(player, entity, s).catch((e) => {
          try {
            player.sendMessage(String(e.message));
          } catch {}
        });
      }),
    );
    if (config.rewards.trade_mode === "npc")
      action("Торговля NPC: выбрать награду", () => npcTradeMenu(player, entity, config));
    else if (config.rewards.trades.length)
      action("Обмен: еда → предметы", () => tradeMenu(player, entity));
    if (!actions.length) return;
    const r = await form.show(player);
    if (r.canceled || !nearby(player, entity)) return;
    await actions[r.selection]?.();
  } catch (e) {
    try {
      player.sendMessage("Мастерская: " + e.message);
    } catch {}
  } finally {
    locks.delete(entity.id);
  }
}
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  if (event.target.typeId !== config.identifier) return;
  if (
    !config.interactions &&
    !config.stories.length &&
    !config.rewards.trades.length &&
    config.rewards.trade_mode !== "npc"
  )
    return;
  event.cancel = true;
  const { player, target } = event;
  system.run(() => menu(player, target));
});
// Interrupted sessions are not resumed after load; persistent manual commands are restored.
system.runInterval(() => {
  for (const dimension of ["overworld", "nether", "the_end"]) {
    for (const entity of world.getDimension(dimension).getEntities({ type: config.identifier })) {
      if (sessions.has(entity.id)) continue;
      try {
        entity.triggerEvent("workshop:" + (entity.getDynamicProperty(MODE) || "default"));
      } catch {}
    }
  }
}, 100);

// Only loaded, living monsters advance timers; unloading never creates a backlog.
const dropWarnings = new Set();
if (config.rewards.timed.length)
  system.runInterval(() => {
    if (!world.gameRules.doMobLoot) return;
    for (const name of ["overworld", "nether", "the_end"])
      for (const entity of world.getDimension(name).getEntities({ type: config.identifier })) {
        try {
          if (entity.getComponent("minecraft:health")?.currentValue <= 0) continue;
          tickDrops(entity, config.rewards.timed, {
            makeStack: (id) => new ItemStack(id, 1),
            drop: (stack) =>
              entity.dimension.spawnItem(stack, { ...entity.location, y: entity.location.y + 0.5 }),
            onError: (row, e) => {
              if (!dropWarnings.has(row.id)) {
                dropWarnings.add(row.id);
                console.warn("Мастерская, предмет " + row.item + ": " + e.message);
              }
            },
          });
        } catch {}
      }
  }, 20);
