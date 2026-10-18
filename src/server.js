// HTTP server: JSON API under /api plus the static single-page app.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import {
  ValidationError, addEntry, createPool, publicView, setResults, tokensMatch, updateEntry,
} from './pool.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 256 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('Request is too large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Request body must be JSON');
  }
}

function isAdmin(req, pool) {
  return tokensMatch(pool.adminToken, req.headers['x-admin-token']);
}

function viewerEntry(req, pool) {
  const id = req.headers['x-entry-id'];
  const entry = pool.entries.find((e) => e.id === id);
  return entry && tokensMatch(entry.editToken, req.headers['x-edit-token']) ? entry : null;
}

function view(req, pool) {
  return publicView(pool, { admin: isAdmin(req, pool), viewerEntryId: viewerEntry(req, pool)?.id ?? null });
}

async function handleApi(req, res, store, parts) {
  const method = req.method;
  if (parts[0] === 'health' && parts.length === 1) return send(res, 200, { ok: true });
  if (parts[0] !== 'pools') return send(res, 404, { error: 'Not found' });

  if (parts.length === 1) {
    if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const pool = createPool(await readJson(req));
    await store.put(pool);
    return send(res, 201, { pool: publicView(pool, { admin: true }), adminToken: pool.adminToken });
  }

  const pool = store.get(parts[1]);
  if (!pool) return send(res, 404, { error: 'Pool not found' });

  if (parts.length === 2) {
    if (method === 'GET') return send(res, 200, { pool: view(req, pool), admin: isAdmin(req, pool) });
    if (!isAdmin(req, pool)) return send(res, 403, { error: 'Only the pool organizer can do that' });
    if (method === 'PATCH') {
      setResults(pool, await readJson(req));
      await store.put(pool);
      return send(res, 200, { pool: view(req, pool) });
    }
    if (method === 'DELETE') {
      await store.delete(pool.id);
      return send(res, 204);
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (parts[2] !== 'entries' || parts.length > 4) return send(res, 404, { error: 'Not found' });

  if (parts.length === 3) {
    if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const entry = addEntry(pool, await readJson(req));
    await store.put(pool);
    return send(res, 201, {
      pool: publicView(pool, { viewerEntryId: entry.id, admin: isAdmin(req, pool) }),
      entryId: entry.id,
      editToken: entry.editToken,
    });
  }

  const entry = pool.entries.find((e) => e.id === parts[3]);
  if (!entry) return send(res, 404, { error: 'Entry not found' });
  const owner = tokensMatch(entry.editToken, req.headers['x-edit-token']);

  if (method === 'PUT') {
    if (!owner) return send(res, 403, { error: 'You can only change your own picks' });
    updateEntry(pool, entry, await readJson(req));
    await store.put(pool);
    return send(res, 200, { pool: publicView(pool, { viewerEntryId: entry.id, admin: isAdmin(req, pool) }) });
  }
  if (method === 'DELETE') {
    if (!isAdmin(req, pool)) return send(res, 403, { error: 'Only the pool organizer can remove entries' });
    pool.entries = pool.entries.filter((e) => e !== entry);
    await store.put(pool);
    return send(res, 200, { pool: view(req, pool) });
  }
  return send(res, 405, { error: 'Method not allowed' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  let file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (file === PUBLIC_DIR || pathname.endsWith('/')) file = join(PUBLIC_DIR, 'index.html');
  let body;
  try {
    body = await readFile(file);
  } catch {
    // Unknown paths fall back to the app shell so deep links work.
    file = join(PUBLIC_DIR, 'index.html');
    body = await readFile(file);
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createApp(store) {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        await handleApi(req, res, store, pathname.split('/').filter(Boolean).slice(1));
      } else {
        await serveStatic(req, res, pathname);
      }
    } catch (err) {
      if (err instanceof ValidationError) return send(res, err.status, { error: err.message });
      if (err instanceof URIError) return send(res, 400, { error: 'Bad request' });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const store = await openStore(join(ROOT, 'data', 'pools.json'));
  createApp(store).listen(port, () => {
    console.log(`Pool is running at http://localhost:${port}`);
  });
}
