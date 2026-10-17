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
