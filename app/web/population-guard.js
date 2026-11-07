// Admission only: existing and reloaded entities are never removed by this policy.
export function cellKey(e, size) {
  return JSON.stringify([e.dimension, size, Math.floor(e.x / size), Math.floor(e.z / size)]);
}
export function restoreRates(raw) {
  try {
    if (typeof raw !== "string" || raw.length > 28000) return new Map();
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 128) return new Map();
    const rates = new Map();
    for (const [key, times] of rows) {
      if (
        typeof key !== "string" ||
        key.length > 180 ||
        !Array.isArray(times) ||
        times.length > 16 ||
        times.some((t) => !Number.isSafeInteger(t) || t < 0)
      )
        return new Map();
      rates.set(key, times);
    }
    return rates;
  } catch {
    return new Map();
  }
}
export function admitBatch(existing, arrivals, s, now, rates = new Map()) {
  const duration = s.period_seconds * 20,
    counts = new Map();
  let total = existing.length;
  for (const [key, times] of rates) {
    const recent = times.map((t) => Math.min(now, t)).filter((t) => now - t < duration);
    if (recent.length) rates.set(key, recent);
    else rates.delete(key);
  }
  for (const e of existing) {
    const key = cellKey(e, s.area_size);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const decisions = [];
  for (const e of arrivals) {
    const key = cellKey(e, s.area_size),
      count = counts.get(key) || 0,
      times = rates.get(key) || [];
    let reason =
      total >= s.loaded_max
        ? "total"
        : count >= s.area_max
          ? "area"
          : times.length >= s.period_max
            ? "rate"
            : !rates.has(key) && rates.size >= 128
              ? "budget"
              : "";
    if (!reason) {
      rates.set(key, [...times, now]);
      if (JSON.stringify([...rates]).length > 28000) {
        if (times.length) rates.set(key, times);
        else rates.delete(key);
        reason = "budget";
      }
    }
    if (!reason) {
      total++;
      counts.set(key, count + 1);
    }
    decisions.push({ id: e.id, allow: !reason, reason });
  }
  return { decisions, rates };
}
