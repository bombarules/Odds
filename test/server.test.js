import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

let server;
let base;
let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pool-test-'));
  const store = await new Store(join(dir, 'pools.json')).load();
  server = createApp(store);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('full pool lifecycle over HTTP', async () => {
  const created = await call('/api/pools', {
    method: 'POST',
    body: { name: 'Office', questions: [{ prompt: 'Winner?', options: ['A', 'B'] }], tiebreakerPrompt: 'Score' },
  });
  assert.equal(created.status, 201);
  const { pool, adminToken } = created.body;
  const admin = { 'X-Admin-Token': adminToken };
  const qid = pool.questions[0].id;

  const bad = await call(`/api/pools/${pool.id}/entries`, { method: 'POST', body: { name: 'Ann', picks: {} } });
  assert.equal(bad.status, 400);

  const ann = await call(`/api/pools/${pool.id}/entries`, { method: 'POST', body: { name: 'Ann', picks: { [qid]: 'A' }, tiebreakerGuess: 10 } });
  assert.equal(ann.status, 201);
  const bo = await call(`/api/pools/${pool.id}/entries`, { method: 'POST', body: { name: 'Bo', picks: { [qid]: 'B' }, tiebreakerGuess: 12 } });
  const annHeaders = { 'X-Entry-Id': ann.body.entryId, 'X-Edit-Token': ann.body.editToken };

  // Ann sees her own picks but not Bo's.
  const asAnn = await call(`/api/pools/${pool.id}`, { headers: annHeaders });
  const entries = Object.fromEntries(asAnn.body.pool.entries.map((e) => [e.name, e]));
  assert.equal(entries.Ann.picks[qid], 'A');
  assert.equal(entries.Bo.picks, null);
  assert.equal(asAnn.body.admin, false);

  // Only the owner can change an entry.
  const steal = await call(`/api/pools/${pool.id}/entries/${bo.body.entryId}`, {
    method: 'PUT', headers: annHeaders, body: { picks: { [qid]: 'A' }, tiebreakerGuess: 1 },
  });
  assert.equal(steal.status, 403);
  const edit = await call(`/api/pools/${pool.id}/entries/${ann.body.entryId}`, {
    method: 'PUT', headers: annHeaders, body: { picks: { [qid]: 'B' }, tiebreakerGuess: 11 },
  });
  assert.equal(edit.status, 200);

  // Only the organizer can post results.
  assert.equal((await call(`/api/pools/${pool.id}`, { method: 'PATCH', body: { locked: true } })).status, 403);
  const results = await call(`/api/pools/${pool.id}`, {
    method: 'PATCH', headers: admin, body: { locked: true, results: { [qid]: 'B' }, tiebreakerAnswer: 12 },
  });
  assert.equal(results.status, 200);

  const after = await call(`/api/pools/${pool.id}`);
  assert.equal(after.body.pool.locked, true);
  assert.deepEqual(after.body.pool.leaderboard.rows.map((r) => [r.name, r.score, r.rank]), [['Bo', 1, 1], ['Ann', 1, 2]]);
  assert.ok(after.body.pool.entries.every((e) => e.picks));

  const late = await call(`/api/pools/${pool.id}/entries`, { method: 'POST', body: { name: 'Cy', picks: { [qid]: 'A' }, tiebreakerGuess: 1 } });
  assert.equal(late.status, 409);

  // Data is persisted to disk without leaking into public responses.
  const saved = JSON.parse(await readFile(join(dir, 'pools.json'), 'utf8'));
  assert.equal(saved.pools[0].entries.length, 2);
  assert.ok(!JSON.stringify(after.body).includes(adminToken));

  const removed = await call(`/api/pools/${pool.id}/entries/${bo.body.entryId}`, { method: 'DELETE', headers: admin });
  assert.equal(removed.body.pool.entries.length, 1);
  assert.equal((await call(`/api/pools/${pool.id}`, { method: 'DELETE', headers: admin })).status, 204);
  assert.equal((await call(`/api/pools/${pool.id}`)).status, 404);
});

test('serves the app shell and blocks path traversal', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>Odds<\/title>/);
  const js = await fetch(`${base}/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  const sneaky = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(sneaky.status, 403);
});

test('rejects malformed JSON', async () => {
  const res = await fetch(`${base}/api/pools`, { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
});
