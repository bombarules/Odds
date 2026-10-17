// Domain logic for office pools: validation, picks, scoring and public views.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const LIMITS = {
  name: 80,
  description: 1000,
  prompt: 200,
  option: 80,
  questions: 100,
  options: 20,
  entries: 500,
};

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function newId(bytes = 6) {
  return randomBytes(bytes).toString('base64url');
}

export function tokensMatch(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function text(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${field} is required`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed;
}

function number(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new ValidationError(`${field} must be a valid date`);
  return new Date(t).toISOString();
}

function parseQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError('Add at least one question');
  if (raw.length > LIMITS.questions) throw new ValidationError(`At most ${LIMITS.questions} questions`);
  return raw.map((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') throw new ValidationError(`${label} is invalid`);
    const prompt = text(q.prompt, `${label} prompt`, LIMITS.prompt);
    if (!Array.isArray(q.options)) throw new ValidationError(`${label} needs options`);
    const options = q.options.map((o) => text(o, `${label} option`, LIMITS.option, { required: false })).filter(Boolean);
    if (options.length < 2) throw new ValidationError(`${label} needs at least two options`);
    if (options.length > LIMITS.options) throw new ValidationError(`${label} has too many options`);
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      throw new ValidationError(`${label} has duplicate options`);
    }
    const points = q.points === undefined || q.points === '' ? 1 : number(q.points, `${label} points`, { min: 1, max: 100, integer: true });
    return { id: newId(4), prompt, options, points, result: null };
  });
}

export function createPool(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  const tiebreakerPrompt = text(input.tiebreakerPrompt, 'Tiebreaker', LIMITS.prompt, { required: false });
  return {
    id: newId(),
    adminToken: newId(18),
    name: text(input.name, 'Pool name', LIMITS.name),
    description: text(input.description, 'Description', LIMITS.description, { required: false }),
    entryFee: input.entryFee === undefined || input.entryFee === '' ? 0 : number(input.entryFee, 'Entry fee', { min: 0, max: 100000 }),
    lockAt: optionalDate(input.lockAt, 'Lock time'),
    lockedManually: false,
    questions: parseQuestions(input.questions),
    tiebreaker: tiebreakerPrompt ? { prompt: tiebreakerPrompt, answer: null } : null,
    entries: [],
    createdAt: new Date().toISOString(),
  };
}

export function isLocked(pool, now = Date.now()) {
  return pool.lockedManually || (pool.lockAt !== null && Date.parse(pool.lockAt) <= now);
}

function parsePicks(pool, rawPicks, rawGuess) {
  if (!rawPicks || typeof rawPicks !== 'object' || Array.isArray(rawPicks)) throw new ValidationError('Picks are required');
  const picks = {};
  for (const q of pool.questions) {
    const choice = rawPicks[q.id];
    if (choice === undefined || choice === null || choice === '') throw new ValidationError(`Pick an answer for "${q.prompt}"`);
    if (!q.options.includes(choice)) throw new ValidationError(`"${choice}" is not an option for "${q.prompt}"`);
    picks[q.id] = choice;
  }
  let tiebreakerGuess = null;
  if (pool.tiebreaker) {
    tiebreakerGuess = number(rawGuess, 'Tiebreaker guess', { min: -1e9, max: 1e9 });
  }
  return { picks, tiebreakerGuess };
}

function assertOpen(pool) {
  if (isLocked(pool)) throw new ValidationError('This pool is locked; picks can no longer change', 409);
}

export function addEntry(pool, input) {
  assertOpen(pool);
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  if (pool.entries.length >= LIMITS.entries) throw new ValidationError('This pool is full', 409);
  const name = text(input.name, 'Your name', LIMITS.name);
  if (pool.entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError('Someone already entered with that name', 409);
  }
  const entry = {
    id: newId(),
    editToken: newId(18),
    name,
    ...parsePicks(pool, input.picks, input.tiebreakerGuess),
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
  pool.entries.push(entry);
  return entry;
}

export function updateEntry(pool, entry, input) {
  assertOpen(pool);
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  Object.assign(entry, parsePicks(pool, input.picks, input.tiebreakerGuess));
  entry.updatedAt = new Date().toISOString();
  return entry;
}

export function setResults(pool, input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid request');
  const results = input.results ?? {};
  if (typeof results !== 'object' || Array.isArray(results)) throw new ValidationError('Results are invalid');
  for (const q of pool.questions) {
    if (!(q.id in results)) continue;
    const r = results[q.id];
    if (r === null || r === '') q.result = null;
    else if (q.options.includes(r)) q.result = r;
    else throw new ValidationError(`"${r}" is not an option for "${q.prompt}"`);
  }
  if (pool.tiebreaker && 'tiebreakerAnswer' in input) {
    const a = input.tiebreakerAnswer;
    pool.tiebreaker.answer = a === null || a === '' ? null : number(a, 'Tiebreaker answer', { min: -1e9, max: 1e9 });
  }
  if (typeof input.locked === 'boolean') pool.lockedManually = input.locked;
  return pool;
}

export function leaderboard(pool) {
  const decided = pool.questions.filter((q) => q.result !== null);
  const maxPossible = pool.questions.reduce((s, q) => s + q.points, 0);
  const tbAnswer = pool.tiebreaker?.answer ?? null;
  const rows = pool.entries.map((e) => {
    let score = 0;
    let correct = 0;
    let remaining = 0;
    for (const q of pool.questions) {
      if (q.result === null) remaining += q.points;
      else if (e.picks[q.id] === q.result) {
        score += q.points;
        correct += 1;
      }
    }
    const tiebreakerDiff = tbAnswer !== null && e.tiebreakerGuess !== null ? Math.abs(e.tiebreakerGuess - tbAnswer) : null;
    return { entryId: e.id, name: e.name, score, correct, decided: decided.length, maxScore: score + remaining, tiebreakerDiff };
  });
  rows.sort((a, b) =>
    b.score - a.score ||
    (a.tiebreakerDiff ?? Infinity) - (b.tiebreakerDiff ?? Infinity) ||
    a.name.localeCompare(b.name));
  // Standard competition ranking: equal score and tiebreaker share a rank.
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score === r.score && prev.tiebreakerDiff === r.tiebreakerDiff ? prev.rank : i + 1;
  });
  return { rows, maxPossible, decidedCount: decided.length, totalQuestions: pool.questions.length };
}

// What anyone with the link may see. Picks stay hidden until the pool locks so
// nobody can copy the field.
export function publicView(pool, { now = Date.now(), viewerEntryId = null, admin = false } = {}) {
  const locked = isLocked(pool, now);
  const showPicks = locked || admin;
  return {
    id: pool.id,
    name: pool.name,
    description: pool.description,
    entryFee: pool.entryFee,
    pot: pool.entryFee * pool.entries.length,
    lockAt: pool.lockAt,
    locked,
    questions: pool.questions.map(({ id, prompt, options, points, result }) => ({ id, prompt, options, points, result })),
    tiebreaker: pool.tiebreaker,
    entries: pool.entries.map((e) => {
      const visible = showPicks || e.id === viewerEntryId;
      return {
        id: e.id,
        name: e.name,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        picks: visible ? e.picks : null,
        tiebreakerGuess: visible ? e.tiebreakerGuess : null,
      };
    }),
    leaderboard: leaderboard(pool),
    createdAt: pool.createdAt,
  };
}
