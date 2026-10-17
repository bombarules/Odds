import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, createPool, isLocked, leaderboard, publicView, setResults, updateEntry } from '../src/pool.js';

function samplePool(extra = {}) {
  return createPool({
    name: 'Finals',
    questions: [
      { prompt: 'Game 1', options: ['Red', 'Blue'], points: 1 },
      { prompt: 'Game 2', options: ['Green', 'Gold'], points: 3 },
    ],
    tiebreakerPrompt: 'Total points',
    entryFee: 10,
    ...extra,
  });
}

const picks = (pool, a, b) => ({ [pool.questions[0].id]: a, [pool.questions[1].id]: b });

test('createPool validates input', () => {
  assert.throws(() => createPool({ name: '', questions: [] }), /Pool name is required/);
  assert.throws(() => createPool({ name: 'x', questions: [] }), /at least one question/);
  assert.throws(() => createPool({ name: 'x', questions: [{ prompt: 'q', options: ['a'] }] }), /at least two options/);
  assert.throws(() => createPool({ name: 'x', questions: [{ prompt: 'q', options: ['a', 'A'] }] }), /duplicate/);
  const pool = createPool({ name: ' x ', questions: [{ prompt: 'q', options: ['a', ' ', 'b'] }] });
  assert.equal(pool.name, 'x');
  assert.deepEqual(pool.questions[0].options, ['a', 'b']);
  assert.equal(pool.questions[0].points, 1);
  assert.equal(pool.tiebreaker, null);
});

test('entries require every pick and a unique name', () => {
  const pool = samplePool();
  assert.throws(() => addEntry(pool, { name: 'Ann', picks: { [pool.questions[0].id]: 'Red' }, tiebreakerGuess: 1 }), /Pick an answer/);
  assert.throws(() => addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Purple'), tiebreakerGuess: 1 }), /not an option/);
  assert.throws(() => addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold') }), /Tiebreaker guess/);
  addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 40 });
  assert.throws(() => addEntry(pool, { name: 'ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 40 }), /already entered/);
});

test('locked pools reject new and changed picks', () => {
  const pool = samplePool();
  const entry = addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 40 });
  setResults(pool, { locked: true });
  assert.ok(isLocked(pool));
  assert.throws(() => addEntry(pool, { name: 'Bo', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 1 }), /locked/);
  assert.throws(() => updateEntry(pool, entry, { picks: picks(pool, 'Blue', 'Gold'), tiebreakerGuess: 1 }), /locked/);
});

test('lockAt in the past locks the pool', () => {
  const pool = samplePool({ lockAt: '2000-01-01T00:00:00Z' });
  assert.ok(isLocked(pool));
  assert.ok(!isLocked(samplePool({ lockAt: '2999-01-01T00:00:00Z' })));
});

test('leaderboard scores by points, then tiebreaker closeness', () => {
  const pool = samplePool();
  addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 40 });
  addEntry(pool, { name: 'Bo', picks: picks(pool, 'Blue', 'Gold'), tiebreakerGuess: 50 });
  addEntry(pool, { name: 'Cy', picks: picks(pool, 'Blue', 'Gold'), tiebreakerGuess: 44 });
  addEntry(pool, { name: 'Di', picks: picks(pool, 'Blue', 'Green'), tiebreakerGuess: 45 });

  let lb = leaderboard(pool);
  assert.equal(lb.decidedCount, 0);
  assert.ok(lb.rows.every((r) => r.score === 0 && r.maxScore === 4 && r.rank === 1));

  setResults(pool, { results: { [pool.questions[0].id]: 'Blue', [pool.questions[1].id]: 'Gold' }, tiebreakerAnswer: 45 });
  lb = leaderboard(pool);
  assert.deepEqual(lb.rows.map((r) => [r.name, r.score, r.rank]), [
    ['Cy', 4, 1],
    ['Bo', 4, 2],
    ['Ann', 3, 3],
    ['Di', 1, 4],
  ]);
  assert.equal(lb.rows[0].tiebreakerDiff, 1);
});

test('equal scores without a tiebreaker answer share a rank', () => {
  const pool = samplePool();
  addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 1 });
  addEntry(pool, { name: 'Bo', picks: picks(pool, 'Red', 'Green'), tiebreakerGuess: 2 });
  addEntry(pool, { name: 'Cy', picks: picks(pool, 'Blue', 'Green'), tiebreakerGuess: 3 });
  setResults(pool, { results: { [pool.questions[0].id]: 'Red' } });
  const lb = leaderboard(pool);
  assert.deepEqual(lb.rows.map((r) => [r.name, r.rank, r.maxScore]), [['Ann', 1, 4], ['Bo', 1, 4], ['Cy', 3, 3]]);
});

test('setResults can clear a result and rejects unknown options', () => {
  const pool = samplePool();
  const qid = pool.questions[0].id;
  setResults(pool, { results: { [qid]: 'Red' } });
  assert.equal(pool.questions[0].result, 'Red');
  setResults(pool, { results: { [qid]: '' } });
  assert.equal(pool.questions[0].result, null);
  assert.throws(() => setResults(pool, { results: { [qid]: 'Pink' } }), /not an option/);
});

test('publicView hides tokens and others’ picks until locked', () => {
  const pool = samplePool();
  const ann = addEntry(pool, { name: 'Ann', picks: picks(pool, 'Red', 'Gold'), tiebreakerGuess: 40 });
  addEntry(pool, { name: 'Bo', picks: picks(pool, 'Blue', 'Gold'), tiebreakerGuess: 50 });

  const view = publicView(pool, { viewerEntryId: ann.id });
  const json = JSON.stringify(view);
  assert.ok(!json.includes(pool.adminToken));
  assert.ok(!json.includes(ann.editToken));
  assert.deepEqual(view.entries[0].picks, ann.picks);
  assert.equal(view.entries[1].picks, null);
  assert.equal(view.pot, 20);

  assert.ok(publicView(pool, { admin: true }).entries.every((e) => e.picks));
  setResults(pool, { locked: true });
  assert.ok(publicView(pool).entries.every((e) => e.picks));
});
