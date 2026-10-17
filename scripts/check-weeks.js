// Validate every slate listed in public/weeks/index.json.
import { readFile } from 'node:fs/promises';
import { validateSlate } from '../public/slate.js';

const dir = new URL('../public/weeks/', import.meta.url);
const index = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
let failed = false;
for (const { file } of index.weeks) {
  const problems = validateSlate(JSON.parse(await readFile(new URL(file, dir), 'utf8')));
  for (const p of problems) console.error(`${file}: ${p}`);
  failed ||= problems.length > 0;
}
if (failed) process.exit(1);
console.log(`${index.weeks.length} slate(s) OK`);
