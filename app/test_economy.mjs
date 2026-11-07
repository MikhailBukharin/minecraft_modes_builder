import assert from "node:assert/strict";
import { planTrade, commitTrade, tickDrops, splitStacks } from "./web/economy.js";
class Stack {
  constructor(type, amount = 1, data = "") {
    if (type === "invalid") throw Error("Unknown item");
    this.typeId = type;
    this.maxAmount = type === "sword" ? 1 : 64;
    this.data = data;
    this.amount = amount;
  }
  set amount(n) {
    if (n < 1 || n > this.maxAmount) throw Error("Invalid amount");
    this.n = n;
  }
  get amount() {
    return this.n;
  }
  clone() {
    return new Stack(this.typeId, this.amount, this.data);
  }
  isStackableWith(other) {
    return this.maxAmount > 1 && this.typeId === other.typeId && this.data === other.data;
  }
}
const make = (id) => new Stack(id),
  trade = { food: "apple", food_count: 3, item: "diamond", count: 5 };
function inventory(items) {
  return {
    size: items.length,
    items: items.map((v) => v?.clone()),
    getItem(i) {
      return this.items[i]?.clone();
    },
    setItem(i, v) {
      this.items[i] = v?.clone();
    },
  };
}
let inv = inventory([
  new Stack("apple", 2),
  new Stack("apple", 2),
  new Stack("diamond", 62),
  undefined,
]);
const plan = planTrade(inv, trade, make);
assert.equal(inv.items[0].amount, 2);
commitTrade(inv, plan);
assert.equal(inv.items[1].amount, 1);
assert.equal(inv.items[2].amount, 64);
assert.equal(inv.items[0].amount, 3);
assert.equal(inv.items[0].typeId, "diamond");
for (const [items, change, message] of [
  [[new Stack("apple", 2), undefined], {}, /Недостаточно/],
  [[new Stack("apple", 4), new Stack("stone", 64)], {}, /Освободите/],
  [[new Stack("apple", 3), undefined], { item: "invalid" }, /Unknown/],
  [[new Stack("apple", 3)], { item: "sword", count: 2 }, /Освободите/],
  [[new Stack("apple", 4), new Stack("diamond", 60, "named")], {}, /Освободите/],
]) {
  inv = inventory(items);
  const before = JSON.stringify(inv.items);
  assert.throws(() => planTrade(inv, { ...trade, ...change }, make), message);
  assert.equal(JSON.stringify(inv.items), before);
}
inv = inventory([new Stack("apple", 3)]);
commitTrade(inv, planTrade(inv, { ...trade, count: 1 }, make));
assert.equal(inv.items[0].typeId, "diamond");
inv = inventory([new Stack("apple", 4), undefined]);
const before = JSON.stringify(inv.items),
  set = inv.setItem;
let once = true;
inv.setItem = function (i, v) {
  if (i === 1 && once) {
    once = false;
    throw Error("Temporary failure");
  }
  set.call(this, i, v);
};
assert.throws(() => commitTrade(inv, planTrade(inv, trade, make)), /Temporary/);
assert.equal(JSON.stringify(inv.items), before);
assert.deepEqual(
  splitStacks("sword", 3, make).map((v) => v.amount),
  [1, 1, 1],
);
const props = new Map(),
  entity = {
    getDynamicProperty: (k) => props.get(k),
    setDynamicProperty: (k, v) => props.set(k, v),
  },
  drops = [];
const row = { id: "test", item: "egg", min: 2, max: 4, chance: 100, seconds: 3 },
  options = { makeStack: make, drop: (s) => drops.push(s), random: () => 0 };
tickDrops(entity, [row], options);
tickDrops(entity, [row], options);
assert.equal(drops.length, 0);
tickDrops(entity, [row], options);
assert.equal(drops[0].amount, 2);
assert.equal(props.get("workshop:drop_test"), 0);
tickDrops(entity, [row], options); // Unloading = no calls; persisted progress resumes at 1 second.
const reloaded = { ...entity };
tickDrops(reloaded, [row], options);
assert.equal(drops.length, 1);
tickDrops(reloaded, [row], options);
assert.equal(drops.length, 2);
for (let i = 0; i < 6; i++) tickDrops(entity, [{ ...row, chance: 0 }], options);
assert.equal(drops.length, 2);
let errors = 0;
tickDrops(
  entity,
  [
    { ...row, id: "bad", item: "invalid", seconds: 1 },
    { ...row, id: "ok", seconds: 1 },
  ],
  { ...options, onError: () => errors++ },
);
assert.equal(errors, 1);
assert.equal(drops.length, 3);
console.log(
  "Economy: costs, full inventory, invalid items, stack sizes, metadata, rollback, persistent timers and chances passed.",
);
