// Shared with the game runtime. Inventory planning has no side effects.
export function splitStacks(item, count, makeStack) {
  const prototype = makeStack(item),
    stacks = [];
  for (let left = count; left > 0;) {
    const n = Math.min(left, prototype.maxAmount),
      stack = prototype.clone();
    stack.amount = n;
    stacks.push(stack);
    left -= n;
  }
  return stacks;
}
export function planTrade(container, trade, makeStack) {
  return planExchange(
    container,
    [{ item: trade.food, count: trade.food_count }],
    splitStacks(trade.item, trade.count, makeStack),
    "Недостаточно еды для обмена.",
  );
}
export function planExchange(
  container,
  costs,
  rewards,
  insufficient = "Недостаточно предметов для обмена.",
) {
  const before = Array.from({ length: container.size }, (_, i) => container.getItem(i)?.clone()),
    after = before.map((v) => v?.clone());
  for (const cost of costs) {
    let required = cost.count;
    for (let i = 0; i < after.length && required > 0; i++)
      if (after[i]?.typeId === cost.item) {
        const n = Math.min(required, after[i].amount);
        required -= n;
        if (n === after[i].amount) after[i] = undefined;
        else after[i].amount -= n;
      }
    if (required) throw Error(insufficient);
  }
  for (const stack of rewards) {
    let left = stack.amount;
    for (const existing of after)
      if (existing?.isStackableWith(stack) && left) {
        const n = Math.min(left, existing.maxAmount - existing.amount);
        existing.amount += n;
        left -= n;
      }
    for (let i = 0; i < after.length && left; i++)
      if (!after[i]) {
        const next = stack.clone();
        next.amount = Math.min(left, next.maxAmount);
        after[i] = next;
        left -= next.amount;
      }
    if (left) throw Error("Освободите место в инвентаре. Предметы не списаны.");
  }
  return { before, after };
}
export function commitTrade(container, plan) {
  try {
    plan.after.forEach((stack, i) => container.setItem(i, stack));
  } catch (e) {
    plan.before.forEach((stack, i) => container.setItem(i, stack));
    throw e;
  }
}
export function tickDrops(
  entity,
  rows,
  { makeStack, drop, random = Math.random, onError = () => {} },
) {
  for (const row of rows) {
    try {
      const key = "workshop:drop_" + row.id,
        elapsed = (Number(entity.getDynamicProperty(key)) || 0) + 1;
      entity.setDynamicProperty(key, elapsed >= row.seconds ? 0 : elapsed);
      if (elapsed < row.seconds || random() * 100 >= row.chance) continue;
      const count = row.min + Math.floor(random() * (row.max - row.min + 1));
      for (const stack of splitStacks(row.item, count, makeStack)) drop(stack);
    } catch (e) {
      onError(row, e);
    }
  }
}
