// Weekly slates: a week of games with odds, plus Claude's picks for it.
// Files live in public/weeks/ and are listed newest first in index.json.
import { formatMoneyline, isMoneyline, winChances } from './odds.js';

export function validateSlate(slate) {
  const problems = [];
  if (!slate || typeof slate !== 'object') return ['Slate must be an object'];
  if (!slate.title) problems.push('title is required');
  if (slate.lockAt && Number.isNaN(Date.parse(slate.lockAt))) problems.push('lockAt must be a date');
  if (!Array.isArray(slate.games) || slate.games.length === 0) problems.push('games must be a non-empty list');
  (slate.games ?? []).forEach((g, i) => {
    const where = `games[${i}]`;
    if (!Array.isArray(g.teams) || g.teams.length !== 2 || g.teams.some((t) => typeof t !== 'string' || !t)) {
      problems.push(`${where}.teams must be two team names`);
    }
    if (!Array.isArray(g.odds) || g.odds.length !== 2 || g.odds.some((n) => !isMoneyline(n))) {
      problems.push(`${where}.odds must be two moneylines`);
    }
  });
  const picks = slate.claude?.picks;
  if (picks) {
    if (!Array.isArray(picks) || picks.length !== (slate.games ?? []).length) problems.push('claude.picks must have one pick per game');
    else picks.forEach((p, i) => {
      if (!slate.games[i]?.teams?.includes(p.pick)) problems.push(`claude.picks[${i}].pick must be one of the game's teams`);
    });
  }
  return problems;
}

export function gameLabel(game) {
  const [a, b] = game.teams;
  const odds = game.odds.map(formatMoneyline);
  return `${a} (${odds[0]}) vs ${b} (${odds[1]})`;
}

// Turn a slate into the body for POST /api/pools.
export function slateToPool(slate) {
  return {
    name: slate.title,
    description: [
      slate.description,
      slate.oddsAsOf && `Odds as of ${slate.oddsAsOf}. Lines move, so check a live book for the latest.`,
      slate.claude?.method && `Claude's entry: ${slate.claude.method}`,
    ].filter(Boolean).join('\n\n'),
    lockAt: slate.lockAt ?? null,
    tiebreakerPrompt: slate.tiebreaker?.prompt ?? '',
    questions: slate.games.map((g) => ({
      prompt: g.label ?? g.teams.join(' vs '),
      options: [...g.teams],
      odds: [...g.odds],
      points: g.points ?? 1,
    })),
  };
}

// Claude's picks keyed by the created pool's question ids.
export function claudeEntry(slate, pool) {
  const c = slate.claude;
  if (!c?.picks) return null;
  return {
    name: c.name ?? 'Claude',
    picks: Object.fromEntries(pool.questions.map((q, i) => [q.id, c.picks[i].pick])),
    tiebreakerGuess: pool.tiebreaker ? c.tiebreakerGuess ?? slate.tiebreaker?.line ?? 0 : undefined,
  };
}

// Decide Claude's picks: take the favorite when the odds make it clear,
// otherwise roll a die weighted by each team's chance.
export function makeClaudePicks(slate, { threshold = 0.6, random = Math.random } = {}) {
  const picks = slate.games.map((g) => {
    const chances = winChances(g.odds, 2);
    const fav = chances[0] >= chances[1] ? 0 : 1;
    const base = { favorite: g.teams[fav], chance: round(chances[fav]) };
    if (chances[fav] >= threshold) {
      return { pick: g.teams[fav], how: 'favorite', ...base };
    }
    const roll = random();
    const i = roll < chances[0] ? 0 : 1;
    return { pick: g.teams[i], how: 'dice', roll: round(roll), ...base };
  });
  const line = slate.tiebreaker?.line;
  return {
    name: 'Claude',
    method: `Took the favorite when the odds give it at least a ${Math.round(threshold * 100)}% chance; rolled a die weighted by the odds for closer games.`,
    picks,
    tiebreakerGuess: typeof line === 'number' ? Math.round(line) : null,
  };
}

const round = (n) => Math.round(n * 1000) / 1000;
