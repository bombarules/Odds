import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { favoriteIndex, impliedProbability, parseOptionLine, rollIndex, winChances } from '../public/odds.js';
import { claudeEntry, makeClaudePicks, slateToPool, validateSlate } from '../public/slate.js';
import { addEntry, createPool } from '../src/pool.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≉ ${b}`);

test('moneylines convert to win chances without the vig', () => {
  close(impliedProbability(-150), 0.6);
  close(impliedProbability(150), 0.4);
  const [fav, dog] = winChances([-350, 275]);
  close(fav + dog, 1);
  assert.ok(fav > 0.7 && fav < 0.8);
  assert.deepEqual(winChances(null, 4), [0.25, 0.25, 0.25, 0.25]);
  assert.equal(favoriteIndex([120, -140], 2), 1);
});

test('dice rolls follow the odds', () => {
  const odds = [-300, 250];
  const [p] = winChances(odds);
  assert.equal(rollIndex(odds, 2, p - 0.01), 0);
  assert.equal(rollIndex(odds, 2, p + 0.01), 1);
  assert.equal(rollIndex(null, 3, 0.99), 2);
});

test('option lines can carry odds', () => {
  assert.deepEqual(parseOptionLine('Bears | -118'), { name: 'Bears', odds: -118 });
  assert.deepEqual(parseOptionLine('49ers +330'), { name: '49ers', odds: 330 });
  assert.deepEqual(parseOptionLine('Room 101'), { name: 'Room 101', odds: null });
});

test('pools keep odds aligned with options and reject bad odds', () => {
  const pool = createPool({ name: 'x', questions: [{ prompt: 'q', options: ['A', '', 'B'], odds: [-150, 999, 130] }] });
  assert.deepEqual(pool.questions[0].options, ['A', 'B']);
  assert.deepEqual(pool.questions[0].odds, [-150, 130]);
  assert.equal(createPool({ name: 'x', questions: [{ prompt: 'q', options: ['A', 'B'] }] }).questions[0].odds, null);
  assert.throws(() => createPool({ name: 'x', questions: [{ prompt: 'q', options: ['A', 'B'], odds: [50, -110] }] }), /moneyline/);
});

test('Claude picks favorites in clear games and rolls the dice in close ones', () => {
  const slate = {
    title: 't',
    games: [{ teams: ['A', 'B'], odds: [-400, 320] }, { teams: ['C', 'D'], odds: [-110, -110] }],
    tiebreaker: { prompt: 'Total', line: 44.5 },
  };
  const result = makeClaudePicks(slate, { random: () => 0.9 });
  assert.equal(result.picks[0].how, 'favorite');
  assert.equal(result.picks[0].pick, 'A');
  assert.equal(result.picks[1].how, 'dice');
  assert.equal(result.picks[1].pick, 'D');
  assert.equal(result.tiebreakerGuess, 45);
});

test('shipped weekly slates are valid and become pools with Claude as an entrant', async () => {
  const dir = new URL('../public/weeks/', import.meta.url);
  const { weeks } = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
  assert.ok(weeks.length > 0);
  for (const { file } of weeks) {
    const slate = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.deepEqual(validateSlate(slate), [], file);
    const pool = createPool({ ...slateToPool(slate), lockAt: null });
    const entry = addEntry(pool, claudeEntry(slate, pool));
    assert.equal(entry.name, 'Claude');
    assert.equal(Object.keys(entry.picks).length, slate.games.length);
  }
});
