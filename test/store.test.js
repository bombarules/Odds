import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedisStore, Store, openStore } from '../src/store.js';

// Minimal stand-in for Upstash's REST endpoint: one hash per key.
function fakeUpstash(token) {
  const hashes = new Map();
  const calls = [];
  const fetch = async (url, { headers, body }) => {
    const [cmd, key, ...rest] = JSON.parse(body);
    calls.push(cmd);
    if (headers.Authorization !== `Bearer ${token}`) return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
    const h = hashes.get(key) ?? new Map();
    hashes.set(key, h);
    let result;
    if (cmd === 'HSET') { h.set(rest[0], rest[1]); result = 1; }
    else if (cmd === 'HDEL') result = h.delete(rest[0]) ? 1 : 0;
    else if (cmd === 'HGETALL') result = [...h].flat();
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetch, calls };
}

test('RedisStore saves, reloads and deletes pools', async () => {
  const up = fakeUpstash('secret');
  const a = await new RedisStore({ url: 'https://x.upstash.io/', token: 'secret', fetch: up.fetch }).load();
  await a.put({ id: 'p1', name: 'One', entries: [] });
  await a.put({ id: 'p2', name: 'Two', entries: [{ name: 'Ann' }] });
  await a.delete('p1');

  const b = await new RedisStore({ url: 'https://x.upstash.io', token: 'secret', fetch: up.fetch }).load();
  assert.equal(b.get('p1'), null);
  assert.equal(b.get('p2').entries[0].name, 'Ann');
  assert.deepEqual(up.calls, ['HGETALL', 'HSET', 'HSET', 'HDEL', 'HGETALL']);
});

test('RedisStore surfaces Upstash errors', async () => {
  const up = fakeUpstash('secret');
  await assert.rejects(new RedisStore({ url: 'https://x', token: 'wrong', fetch: up.fetch }).load(), /Unauthorized/);
});

test('openStore uses a file unless Upstash is configured', async () => {
  const store = await openStore(null, {});
  assert.ok(store instanceof Store);
});
