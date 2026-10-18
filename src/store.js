// A tiny JSON-file store. All pools live in memory and are flushed to disk
// after each change; writes go to a temp file and are renamed into place so a
// crash never leaves a half-written database.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Store {
  constructor(file) {
    this.file = file;
    this.pools = new Map();
    this.pending = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      for (const pool of data.pools ?? []) this.pools.set(pool.id, pool);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return this;
  }

  get(id) {
    return this.pools.get(id) ?? null;
  }

  put(pool) {
    this.pools.set(pool.id, pool);
    return this.save();
  }

  delete(id) {
    this.pools.delete(id);
    return this.save();
  }

  save() {
    if (!this.file) return Promise.resolve();
    // Chain writes so they land in order and never interleave.
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ pools: [...this.pools.values()] }, null, 2));
      await rename(tmp, this.file);
    });
    return this.pending;
  }
}

// Keeps pools in an Upstash Redis hash (one field per pool) over its REST API,
// for hosts whose disk is wiped on every restart. Same interface as Store.
export class RedisStore {
  constructor({ url, token, key = 'pool:pools', fetch: fetchFn = globalThis.fetch }) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.key = key;
    this.fetch = fetchFn;
    this.pools = new Map();
    this.pending = Promise.resolve();
  }

  async command(...args) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Redis ${args[0]} failed: ${data.error ?? res.status}`);
    return data.result;
  }

  async load() {
    // HGETALL returns a flat [field, value, field, value, ...] list.
    const flat = (await this.command('HGETALL', this.key)) ?? [];
    for (let i = 1; i < flat.length; i += 2) {
      const pool = JSON.parse(flat[i]);
      this.pools.set(pool.id, pool);
    }
    return this;
  }

  get(id) {
    return this.pools.get(id) ?? null;
  }

  put(pool) {
    this.pools.set(pool.id, pool);
    const json = JSON.stringify(pool);
    return this.queue(() => this.command('HSET', this.key, pool.id, json));
  }

  delete(id) {
    this.pools.delete(id);
    return this.queue(() => this.command('HDEL', this.key, id));
  }

  queue(task) {
    this.pending = this.pending.catch(() => {}).then(task);
    return this.pending;
  }
}

// Upstash when its credentials are set, otherwise a JSON file on disk.
export function openStore(defaultFile, env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisStore({ url, token }).load();
  return new Store(env.DATA_FILE || defaultFile).load();
}
