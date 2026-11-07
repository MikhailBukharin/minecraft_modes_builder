import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getNpcOffer,
  sameNpcOffer,
  executeNpcExchange,
  verifyNpcReward,
  NPC_OFFER_KEY,
} from "./web/npc-trade.js";
const config = {
  refresh_seconds: 600,
  max_uses: 2,
  requests: [
    { id: "iron", item: "iron", min: 8, max: 12 },
    { id: "wheat", item: "wheat", min: 24, max: 40 },
  ],
  rewards: [
    { id: "diamond", choice: "diamond", count: 2 },
    { id: "potion", choice: "potion_healing", count: 1 },
    { id: "book", choice: "book_mending", count: 1 },
  ],
};
const diamond = { id: "diamond", item: "diamond", count: 2, label: "Алмаз" },
  potion = { id: "potion", item: "potion", count: 1, potion: "healing", label: "Зелье" },
  book = {
    id: "book",
    item: "enchanted_book",
    count: 1,
    enchantment: "mending",
    level: 1,
    label: "Книга",
  };
const first = getNpcOffer(config, null, 100, () => 0);
assert.equal(first.request_id, "iron");
assert.equal(first.count, 8);
const reopened = getNpcOffer(config, JSON.parse(JSON.stringify({ ...first, uses: 2 })), 101, () => {
  throw Error("Menu reopened must not reroll");
});
assert.equal(reopened.uses, 2);
assert.equal(
  getNpcOffer(config, first, 12099, () => {
    throw Error("Early reroll");
  }).created,
  100,
);
const renewed = getNpcOffer(config, first, 12100, () => 0.9999);
assert.equal(renewed.request_id, "wheat");
assert.equal(renewed.count, 40);
assert.equal(renewed.uses, 0);
assert.equal(sameNpcOffer(renewed, first), false);
assert.equal(getNpcOffer(config, { ...first, uses: 1 }, 50).uses, 1);
assert.notEqual(
  getNpcOffer({ ...config, max_uses: 3 }, first, 101, () => 0).signature,
  first.signature,
);
class Stack {
  constructor(type, amount = 1, metadata = {}) {
    this.typeId = type;
    this.maxAmount = ["potion", "enchanted_book"].includes(type) ? 1 : 64;
    this.amount = amount;
    this.metadata = metadata;
  }
  clone() {
    return new Stack(this.typeId, this.amount, { ...this.metadata });
  }
  isStackableWith(other) {
    return (
      this.maxAmount > 1 &&
      this.typeId === other.typeId &&
      JSON.stringify(this.metadata) === JSON.stringify(other.metadata)
    );
  }
  getComponent(type) {
    if (type === "minecraft:potion" && this.typeId === "potion")
      return { potionEffectType: { id: "minecraft:" + this.metadata.potion } };
    if (type === "minecraft:enchantable")
      return {
        getEnchantment: (id) =>
          this.metadata.enchantment === id.replace("minecraft:", "")
            ? { level: this.metadata.level }
            : undefined,
      };
  }
}
function inventory(items) {
  return {
    size: items.length,
    items: items.map((s) => s?.clone()),
    getItem(i) {
      return this.items[i]?.clone();
    },
    setItem(i, s) {
      this.items[i] = s?.clone();
    },
  };
}
const rewardStacks = (r) => [
  new Stack(
    r.item,
    r.count,
    r.potion
      ? { potion: r.potion }
      : r.enchantment
        ? { enchantment: r.enchantment, level: r.level }
        : {},
  ),
];
function transaction(inv, options = {}) {
  let state = JSON.stringify(first);
  const args = {
    container: inv,
    config,
    offer: first,
    snapshot: first,
    reward: diamond,
    createReward: rewardStacks,
    readState: () => state,
    writeState: (v) => (state = v),
    ...options,
  };
  return { args, read: () => state, run: () => executeNpcExchange(args) };
}
let inv = inventory([new Stack("iron", 20), undefined, undefined]),
  t = transaction(inv);
const updated = t.run();
assert.equal(inv.items[0].amount, 12);
assert.equal(inv.items[1].amount, 2);
assert.equal(inv.items[1].typeId, "diamond");
assert.equal(updated.uses, 1);
assert.equal(JSON.parse(t.read()).uses, 1);
t.args.offer = updated;
t.args.snapshot = updated;
const last = t.run();
assert.equal(last.uses, 2);
t.args.offer = last;
t.args.snapshot = last;
assert.throws(t.run, /исчерпан/);
for (const reward of [potion, book]) {
  inv = inventory([new Stack("iron", 8), undefined]);
  t = transaction(inv, { reward });
  t.run();
  assert.equal(inv.items[0].typeId, reward.item);
  assert.ok(inv.items[0].metadata.potion || inv.items[0].metadata.enchantment);
}
for (const [items, options, error] of [
  [[new Stack("iron", 7), undefined], {}, /Недостаточно/],
  [[new Stack("iron", 9), new Stack("stone", 64)], { reward: book }, /Освободите/],
  [[new Stack("iron", 8), undefined], { offer: renewed }, /обновилось/],
  [[new Stack("iron", 8), undefined], { reward: { ...diamond, id: "unlisted" } }, /недоступна/],
  [
    [new Stack("iron", 8), undefined],
    {
      createReward: () => {
        throw Error("missing table");
      },
    },
    /missing table/,
  ],
  [
    [new Stack("iron", 8), undefined],
    { reward: potion, createReward: () => [new Stack("potion", 1, { potion: "water" })] },
    /неверный эффект/,
  ],
  [
    [new Stack("iron", 8), undefined],
    {
      reward: book,
      createReward: () => [new Stack("enchanted_book", 1, { enchantment: "mending", level: 2 })],
    },
    /Зачарование/,
  ],
]) {
  inv = inventory(items);
  const before = JSON.stringify(inv.items);
  t = transaction(inv, options);
  assert.throws(t.run, error);
  assert.equal(JSON.stringify(inv.items), before);
  assert.equal(JSON.parse(t.read()).uses, 0);
}
inv = inventory([new Stack("iron", 9), undefined]);
const before = JSON.stringify(inv.items),
  set = inv.setItem;
let fail = true;
inv.setItem = function (i, s) {
  if (i === 1 && fail) {
    fail = false;
    throw Error("inventory failed");
  }
  set.call(this, i, s);
};
t = transaction(inv);
assert.throws(t.run, /inventory failed/);
assert.equal(JSON.stringify(inv.items), before);
assert.equal(JSON.parse(t.read()).uses, 0);
inv = inventory([new Stack("iron", 8), undefined]);
t = transaction(inv, {
  writeState: () => {
    throw Error("state failed");
  },
});
assert.throws(t.run, /state failed/);
assert.equal(inv.items[0].amount, 8);
assert.throws(() => verifyNpcReward([new Stack("diamond", 1)], diamond), /не создана/);

// Actual game-menu module with API doubles: selection, confirmation and cancel.
const source = fs
  .readFileSync(new URL("./npc-trade-runtime.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replace("export async function npcTradeMenu", "async function npcTradeMenu");
async function gameMenu(answers) {
  const props = new Map(),
    messages = [],
    forms = [];
  const inv = inventory([new Stack("iron", 64), new Stack("wheat", 64), undefined, undefined]);
  class Form {
    constructor() {
      this.text = "";
      this.buttons = [];
    }
    title(v) {
      this.titleValue = v;
      return this;
    }
    body(v) {
      this.text = v;
      return this;
    }
    button(v) {
      this.buttons.push(v);
      return this;
    }
    async show() {
      forms.push(this);
      return answers.shift() || { canceled: true };
    }
  }
  const world = {
    getAbsoluteTime: () => 100,
    getLootTableManager: () => ({
      getLootTable: (path) => path,
      generateLootFromTable: (path) => rewardStacks(path === "book" ? book : diamond),
    }),
  };
  const player = {
    dimension: { id: "overworld" },
    location: { x: 0, y: 0, z: 0 },
    getComponent: () => ({ container: inv }),
    sendMessage: (s) => messages.push(s),
  };
  const entity = {
    dimension: { id: "overworld" },
    location: { x: 1, y: 0, z: 0 },
    getDynamicProperty: (k) => props.get(k),
    setDynamicProperty: (k, v) => props.set(k, v),
    getComponent: () => ({ currentValue: 30 }),
  };
  const run = new Function(
    "world",
    "ActionFormData",
    "itemLabel",
    "NPC_OFFER_KEY",
    "getNpcOffer",
    "executeNpcExchange",
    source + ";return npcTradeMenu;",
  )(world, Form, (id) => id, NPC_OFFER_KEY, getNpcOffer, executeNpcExchange);
  const c = {
    name: "NPC",
    rewards: { npc_trade: config },
    npc_rewards: [
      { ...diamond, loot_table: "diamond" },
      { ...book, loot_table: "book" },
    ],
  };
  await run(player, entity, c);
  return { props, messages, forms, inv };
}
let game = await gameMenu([
  { canceled: false, selection: 1 },
  { canceled: false, selection: 0 },
]);
assert.equal(JSON.parse(game.props.get(NPC_OFFER_KEY)).uses, 1);
assert.ok(game.inv.items.some((v) => v?.typeId === "enchanted_book"));
assert.equal(game.forms[0].buttons.length, 2);
assert.equal(game.messages.length, 1);
game = await gameMenu([
  { canceled: false, selection: 0 },
  { canceled: false, selection: 1 },
]);
assert.equal(JSON.parse(game.props.get(NPC_OFFER_KEY)).uses, 0);
assert.equal(game.inv.items[0].amount, 64);
assert.equal(game.inv.items[1].amount, 64);
console.log(
  "NPC trading: persistent random requests, refresh, stock, chosen rewards, real-effect checks, cost/space validation, state and inventory rollback, game menu and cancellation passed.",
);
