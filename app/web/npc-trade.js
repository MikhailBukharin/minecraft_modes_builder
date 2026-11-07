import { planExchange, commitTrade } from "./economy.js";
export const NPC_OFFER_KEY = "workshop:npc_offer";
export function offerSignature(config) {
  let hash = 2166136261;
  for (const c of JSON.stringify(config)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
export function getNpcOffer(config, previous, now, random = Math.random) {
  if (!config.requests.length || !config.rewards.length)
    throw Error("У NPC не настроены запросы или награды.");
  const signature = offerSignature(config),
    request = config.requests.find((r) => r.id === previous?.request_id);
  if (
    previous?.signature === signature &&
    request &&
    Number.isSafeInteger(previous.created) &&
    previous.created >= 0 &&
    Number.isInteger(previous.count) &&
    previous.count >= request.min &&
    previous.count <= request.max &&
    Number.isInteger(previous.uses) &&
    previous.uses >= 0 &&
    previous.uses <= config.max_uses
  ) {
    if (now < previous.created) return { ...previous, created: now };
    if (now - previous.created < config.refresh_seconds * 20) return { ...previous };
  }
  const n = config.requests[Math.floor(random() * config.requests.length)];
  return {
    signature,
    created: now,
    request_id: n.id,
    count: n.min + Math.floor(random() * (n.max - n.min + 1)),
    uses: 0,
  };
}
export function sameNpcOffer(a, b) {
  return (
    a.signature === b.signature &&
    a.created === b.created &&
    a.request_id === b.request_id &&
    a.count === b.count
  );
}
export function verifyNpcReward(stacks, definition) {
  if (
    !Array.isArray(stacks) ||
    !stacks.length ||
    stacks.some((s) => s.typeId !== definition.item) ||
    stacks.reduce((n, s) => n + s.amount, 0) !== definition.count
  )
    throw Error("Награда NPC не создана корректно. Предметы не списаны.");
  for (const stack of stacks) {
    if (
      definition.potion &&
      stack.getComponent("minecraft:potion")?.potionEffectType?.id?.replace(/^minecraft:/, "") !==
        definition.potion
    )
      throw Error("У зелья неверный эффект. Предметы не списаны.");
    if (
      definition.enchantment &&
      stack
        .getComponent("minecraft:enchantable")
        ?.getEnchantment("minecraft:" + definition.enchantment)?.level !== definition.level
    )
      throw Error("Зачарование книги не создано. Предметы не списаны.");
  }
  return stacks;
}
export function executeNpcExchange({
  container,
  config,
  offer,
  snapshot,
  reward,
  createReward,
  readState,
  writeState,
}) {
  if (!sameNpcOffer(offer, snapshot))
    throw Error("Предложение NPC обновилось. Откройте торговлю снова.");
  if (offer.uses >= config.max_uses)
    throw Error("Запас сделок исчерпан. Дождитесь обновления запроса.");
  if (!config.rewards.some((r) => r.id === reward.id))
    throw Error("Эта награда больше недоступна.");
  const request = config.requests.find((r) => r.id === offer.request_id);
  if (!request) throw Error("Запрос NPC больше недоступен.");
  const stacks = verifyNpcReward(createReward(reward), reward),
    plan = planExchange(container, [{ item: request.item, count: offer.count }], stacks);
  const before = readState(),
    updated = { ...offer, uses: offer.uses + 1 };
  writeState(JSON.stringify(updated));
  try {
    commitTrade(container, plan);
  } catch (e) {
    writeState(before);
    throw e;
  }
  return updated;
}
