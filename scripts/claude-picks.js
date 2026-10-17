// Fill in Claude's picks for a weekly slate.
//   node scripts/claude-picks.js public/weeks/nfl-2026-week-06.json [--force]
import { readFile, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { makeClaudePicks, validateSlate } from '../public/slate.js';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/claude-picks.js <slate.json> [--force]');
  process.exit(1);
}
const slate = JSON.parse(await readFile(file, 'utf8'));
if (slate.claude && flag !== '--force') {
  console.error(`${file} already has Claude's picks; pass --force to roll again`);
  process.exit(1);
}
const problems = validateSlate({ ...slate, claude: undefined });
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
slate.claude = makeClaudePicks(slate, { random: () => randomInt(1_000_000) / 1_000_000 });
await writeFile(file, `${JSON.stringify(slate, null, 2)}\n`);
for (const [i, p] of slate.claude.picks.entries()) {
  const how = p.how === 'dice' ? `dice roll ${p.roll}` : 'favorite';
  console.log(`${slate.games[i].teams.join(' vs ').padEnd(24)} → ${p.pick.padEnd(11)} (${how}; ${p.favorite} ${Math.round(p.chance * 100)}%)`);
}
console.log(`Tiebreaker guess: ${slate.claude.tiebreakerGuess}`);
