// Copy pools saved on this device (data/pools.json) into Upstash, so a hosted
// Pool shows them. Existing pools with the same id are overwritten.
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npm run copy-to-upstash
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RedisStore, Store } from '../src/store.js';

const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
if (!url || !token) {
  console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN first (both are on your Upstash database page).');
  process.exit(1);
}
const file = process.env.DATA_FILE || join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'pools.json');
const local = await new Store(file).load();
const remote = new RedisStore({ url, token });
for (const pool of local.pools.values()) {
  await remote.put(pool);
  console.log(`Copied “${pool.name}” (${pool.entries.length} entries)`);
}
console.log(local.pools.size ? 'Done. Restart the hosted app to load them (Render → your service → Manual Deploy → Restart service).' : `No pools found in ${file}.`);
