// Station Planner server
// Stores sites, plans, images and settings in one SQLite database and serves the app.
// No login yet: anyone who can reach this server can read and change the data.
// Needs Node.js 22.13+ (uses the built-in node:sqlite module, no npm install).

import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || '/var/lib/floorplan/floorplan.db';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || '/opt/floorplan/public');
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = Number(process.env.MAX_BODY_MB || 60) * 1024 * 1024;
const STORES = new Set(['sites', 'maps', 'assets', 'meta']);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS records (
    store   TEXT    NOT NULL,          -- sites | maps | assets | meta
    id      TEXT    NOT NULL,
    site_id TEXT,                      -- set for plans, so a site's plans can be listed quickly
    data    TEXT    NOT NULL,          -- the record as JSON
    updated INTEGER NOT NULL,          -- ms since epoch, set by the server
    PRIMARY KEY (store, id)
  );
  CREATE INDEX IF NOT EXISTS records_by_site ON records (store, site_id);
`);

const q = {
  list:     db.prepare('SELECT data FROM records WHERE store = ? ORDER BY updated DESC'),
  listSite: db.prepare('SELECT data FROM records WHERE store = ? AND site_id = ? ORDER BY updated DESC'),
  get:      db.prepare('SELECT data FROM records WHERE store = ? AND id = ?'),
  put:      db.prepare(`INSERT INTO records (store, id, site_id, data, updated) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (store, id) DO UPDATE SET site_id = excluded.site_id, data = excluded.data, updated = excluded.updated`),
  del:      db.prepare('DELETE FROM records WHERE store = ? AND id = ?'),
  counts:   db.prepare('SELECT store, COUNT(*) AS n FROM records GROUP BY store'),
};

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const any = ALLOWED.includes('*');
  if (!any && !ALLOWED.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', any ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad path', 'text/plain'); }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + p);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://localhost');

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      return serveStatic(res, url.pathname);
    }

    const parts = url.pathname.slice(5).split('/').filter(Boolean).map(s => decodeURIComponent(s));
    if (parts[0] === 'health' && parts.length === 1) {
      const counts = Object.fromEntries(q.counts.all().map(r => [r.store, r.n]));
      return json(res, 200, { ok: true, app: 'station-planner', counts });
    }

    const [store, id] = parts;
    if (!STORES.has(store) || parts.length > 2) return json(res, 404, { error: 'Unknown path' });

    if (!id) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const siteId = url.searchParams.get('siteId');
      const rows = siteId ? q.listSite.all(store, siteId) : q.list.all(store);
      return send(res, 200, '[' + rows.map(r => r.data).join(',') + ']');
    }
    if (id.length > 200) return json(res, 400, { error: 'Bad id' });

    if (req.method === 'GET') {
      const row = q.get.get(store, id);
      return row ? send(res, 200, row.data) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'PUT') {
      const text = await readBody(req);
      let obj;
      try { obj = JSON.parse(text); } catch { return json(res, 400, { error: 'Body must be JSON' }); }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.id !== id) return json(res, 400, { error: 'The record id must match the address' });
      q.put.run(store, id, typeof obj.siteId === 'string' ? obj.siteId : null, text, Date.now());
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      q.del.run(store, id);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 413 ? 'Upload too large' : 'Server error' });
  }
});

server.listen(PORT, HOST, () => console.log(`Station Planner server listening on http://${HOST}:${PORT} (database ${DB_PATH})`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
