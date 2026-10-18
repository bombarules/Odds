// Start Pool and give it a public https link so friends can join from any
// phone, on any network. Uses a free Cloudflare quick tunnel (no account).
//   npm run share
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || join(ROOT, 'data', 'pools.json');
const bin = process.env.CLOUDFLARED || 'cloudflared';

const store = await new Store(dataFile).load();
const server = createApp(store);
await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
console.log(`Pool is running at http://localhost:${port}`);
console.log('Getting your public link…');

const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let announced = false;
const watch = (chunk) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
  if (!url || announced) return;
  announced = true;
  console.log(`
  ✅ Your public Pool link:

     ${url}

  1. Open that link in your browser (Chrome or Safari), not localhost.
  2. Create or open your pool there and tap Share or Copy on the invite link.
  3. Keep this screen open. Closing it, or Ctrl+C, stops the link.
     A new link is made each time you run this, so re-send invites after a restart.
`);
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);
tunnel.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`
  cloudflared isn't installed, so there's no public link yet.
  Install it, then run npm run share again:

     Termux (Android):  pkg install cloudflared
     Mac:               brew install cloudflared
     Other:             https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

  Pool is still running at http://localhost:${port}, but only this device can open it.
`);
  } else {
    console.error(`Couldn't start cloudflared: ${err.message}`);
  }
});
tunnel.on('exit', (code) => {
  if (code !== null && announced) console.error(`The public link stopped (cloudflared exited with ${code}). Run npm run share again.`);
});

const stop = () => {
  tunnel.kill();
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
