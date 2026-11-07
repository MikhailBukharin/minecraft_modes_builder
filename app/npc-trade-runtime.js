import { world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { itemLabel } from "./items.js";
import { NPC_OFFER_KEY, getNpcOffer, executeNpcExchange } from "./npc-trade.js";

export async function npcTradeMenu(player, entity, config) {
  const n = config.rewards.npc_trade;
  function closeEnough() {
    if (
      player.dimension.id !== entity.dimension.id ||
      Math.hypot(
        player.location.x - entity.location.x,
        player.location.y - entity.location.y,
        player.location.z - entity.location.z,
      ) > 6
    )
      throw Error("Подойдите ближе к NPC.");
    if (entity.getComponent("minecraft:health")?.currentValue <= 0)
      throw Error("Этот NPC уже погиб.");
  }
  function offer() {
    const raw = entity.getDynamicProperty(NPC_OFFER_KEY);
    let previous;
    try {
      previous = JSON.parse(raw);
    } catch {}
    const value = getNpcOffer(n, previous, world.getAbsoluteTime()),
      next = JSON.stringify(value);
    if (next !== raw) entity.setDynamicProperty(NPC_OFFER_KEY, next);
    return value;
  }
  closeEnough();
  const snapshot = offer(),
    request = n.requests.find((r) => r.id === snapshot.request_id),
    now = world.getAbsoluteTime();
  const remaining = Math.max(
    0,
    Math.ceil((n.refresh_seconds * 20 - (now - snapshot.created)) / 20),
  );
  if (snapshot.uses >= n.max_uses)
    throw Error("Запас сделок исчерпан. До обновления запроса: " + remaining + " с.");
  const body = `Мне нужно: ${itemLabel(request.item)} ×${snapshot.count}.\nВыберите одну награду.\nОсталось сделок: ${n.max_uses - snapshot.uses}. До обновления запроса: ${remaining} с.`;
  const form = new ActionFormData().title(config.name + " · Торговля").body(body);
  config.npc_rewards.forEach((r) => form.button(r.label + " ×" + r.count));
  const choice = await form.show(player);
  if (choice.canceled) return;
  const reward = config.npc_rewards[choice.selection];
  if (!reward) return;
  closeEnough();
  const confirm = await new ActionFormData()
    .title("Подтвердить обмен")
    .body(
      `Отдать: ${itemLabel(request.item)} ×${snapshot.count}\nПолучить: ${reward.label} ×${reward.count}`,
    )
    .button("Обменять")
    .button("Отмена")
    .show(player);
  if (confirm.canceled || confirm.selection !== 0) return;
  closeEnough();
  const current = offer(),
    container = player.getComponent("minecraft:inventory")?.container;
  if (!container) throw Error("Инвентарь недоступен.");
  executeNpcExchange({
    container,
    config: n,
    offer: current,
    snapshot,
    reward,
    createReward: (r) => {
      const manager = world.getLootTableManager(),
        table = manager.getLootTable(r.loot_table);
      if (!table)
        throw Error("Таблица награды NPC не найдена. Импортируйте новую версию дополнения.");
      return manager.generateLootFromTable(table);
    },
    readState: () => entity.getDynamicProperty(NPC_OFFER_KEY),
    writeState: (value) => entity.setDynamicProperty(NPC_OFFER_KEY, value),
  });
  player.sendMessage(`${config.name}: получено ${reward.label} ×${reward.count}.`);
  return true;
}
