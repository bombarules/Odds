// Odds helpers shared by the browser app, the server and the weekly scripts.
// Odds are American moneylines: -150 means bet 150 to win 100 (favorite),
// +130 means bet 100 to win 130 (underdog).

export function isMoneyline(n) {
  return Number.isInteger(n) && Math.abs(n) >= 100 && Math.abs(n) <= 100000;
}

export function impliedProbability(moneyline) {
  return moneyline < 0 ? -moneyline / (-moneyline + 100) : 100 / (moneyline + 100);
}

// Win chance for each option with the bookmaker's margin removed, so the
// numbers add up to 1. Options without odds share whatever is left evenly;
// with no odds at all every option is equally likely.
export function winChances(odds, count = odds?.length ?? 0) {
  const raw = Array.from({ length: count }, (_, i) =>
    (odds && isMoneyline(odds[i]) ? impliedProbability(odds[i]) : null));
  const known = raw.filter((p) => p !== null);
  if (known.length === 0) return raw.map(() => 1 / count);
  if (known.length === count) {
    const total = known.reduce((s, p) => s + p, 0);
    return raw.map((p) => p / total);
  }
  const knownTotal = Math.min(known.reduce((s, p) => s + p, 0), 0.99);
  const share = (1 - knownTotal) / (count - known.length);
  return raw.map((p) => (p === null ? share : p));
}

export function favoriteIndex(odds, count) {
  const chances = winChances(odds, count);
  return chances.indexOf(Math.max(...chances));
}

// Pick an option at random, weighted by its win chance. `roll` is a number in
// [0, 1) so callers can supply their own source of randomness.
export function rollIndex(odds, count, roll = Math.random()) {
  const chances = winChances(odds, count);
  let acc = 0;
  for (let i = 0; i < chances.length; i++) {
    acc += chances[i];
    if (roll < acc) return i;
  }
  return chances.length - 1;
}

export function formatMoneyline(n) {
  return n > 0 ? `+${n}` : String(n);
}

// "Bears | -118" or "Bears -118" → { name: 'Bears', odds: -118 }
export function parseOptionLine(line) {
  const m = /^(.*?)(?:\s*\|\s*|\s+)([+-]\d{3,6})\s*$/.exec(line.trim());
  if (m && m[1] && isMoneyline(Number(m[2]))) return { name: m[1].trim(), odds: Number(m[2]) };
  return { name: line.trim(), odds: null };
}
