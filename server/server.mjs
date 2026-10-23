// Station Planner server
// Stores sites, plans, images and settings in one SQLite database and serves the app.
// Sign-in: Google accounts. Only approved email addresses (or whole approved domains) get in.
// Needs Node.js 22.13+ (uses the built-in node:sqlite module, no npm install).
//
// Settings (environment variables, normally in /etc/floorplan.env):
//   GOOGLE_CLIENT_ID   OAuth "Web application" client ID. Leave empty to run with NO sign-in.
//   ADMIN_EMAILS       comma-separated emails that are always allowed and can manage users
//   ALLOWED_DOMAINS    optional, comma-separated domains whose Google accounts may sign in (e.g. mycompany.co.nz)
//   ALLOWED_ORIGINS    web addresses allowed to call the API (* = any)
//   SESSION_MINUTES    sign out after this many minutes with no activity (default 5)

import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || '/var/lib/floorplan/floorplan.db';
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || '/opt/floorplan/public');
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = Number(process.env.MAX_BODY_MB || 60) * 1024 * 1024;
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
const SESSION_MS = Number(process.env.SESSION_MINUTES || 5) * 60000;
const GOOGLE_CERTS_URL = process.env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const AUTH_ON = !!GOOGLE_CLIENT_ID;
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
    updated INTEGER NOT NULL,
    PRIMARY KEY (store, id)
  );
  CREATE INDEX IF NOT EXISTS records_by_site ON records (store, site_id);
  CREATE TABLE IF NOT EXISTS users (
    email      TEXT PRIMARY KEY,       -- lower case
    role       TEXT NOT NULL DEFAULT 'user',   -- user | admin
    name       TEXT,
    picture    TEXT,
    added      INTEGER NOT NULL,
    added_by   TEXT,
    last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,       -- sha256 of the token; the token itself is never stored
    email      TEXT NOT NULL,
    created    INTEGER NOT NULL,
    expires    INTEGER NOT NULL
  );
`);

// Who created each site or plan. Older records (from before ownership) have no owner and only admins can change them.
if (!db.prepare("SELECT 1 FROM pragma_table_info('records') WHERE name = 'owner'").get()) db.exec('ALTER TABLE records ADD COLUMN owner TEXT');

const q = {
  list:     db.prepare('SELECT data FROM records WHERE store = ? ORDER BY updated DESC'),
  listSite: db.prepare('SELECT data FROM records WHERE store = ? AND site_id = ? ORDER BY updated DESC'),
  get:      db.prepare('SELECT data FROM records WHERE store = ? AND id = ?'),
  row:      db.prepare('SELECT owner FROM records WHERE store = ? AND id = ?'),
  setOwner: db.prepare('UPDATE records SET owner = ? WHERE store = ? AND id = ?'),
  people:   db.prepare('SELECT email, name FROM users'),
  put:      db.prepare(`INSERT INTO records (store, id, site_id, data, updated) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT (store, id) DO UPDATE SET site_id = excluded.site_id, data = excluded.data, updated = excluded.updated`),
  del:      db.prepare('DELETE FROM records WHERE store = ? AND id = ?'),
  counts:   db.prepare('SELECT store, COUNT(*) AS n FROM records GROUP BY store'),
  user:     db.prepare('SELECT * FROM users WHERE email = ?'),
  users:    db.prepare('SELECT email, role, name, picture, added, added_by, last_login FROM users ORDER BY role DESC, email'),
  addUser:  db.prepare(`INSERT INTO users (email, role, added, added_by) VALUES (?, ?, ?, ?)
                        ON CONFLICT (email) DO UPDATE SET role = excluded.role`),
  seenUser: db.prepare('UPDATE users SET name = ?, picture = ?, last_login = ? WHERE email = ?'),
  delUser:  db.prepare('DELETE FROM users WHERE email = ?'),
  admins:   db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
  newSess:  db.prepare('INSERT INTO sessions (token_hash, email, created, expires) VALUES (?, ?, ?, ?)'),
  sess:     db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
  touch:    db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
  endSess:  db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  endUser:  db.prepare('DELETE FROM sessions WHERE email = ?'),
  oldSess:  db.prepare('DELETE FROM sessions WHERE expires < ?'),
};

// Admins named in the settings are always present and always admins.
for (const e of ADMIN_EMAILS) q.addUser.run(e, 'admin', Date.now(), 'settings');
setInterval(() => q.oldSess.run(Date.now()), 60000).unref();

/* ---------- Google ID token check (RS256, keys fetched from Google and cached) ---------- */
let certs = { keys: [], until: 0 };
async function googleKeys(force) {
  if (!force && certs.until > Date.now()) return certs.keys;
  const r = await fetch(GOOGLE_CERTS_URL);
  if (!r.ok) throw new Error('Could not fetch Google signing keys');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  const j = await r.json();
  certs = { keys: j.keys || [], until: Date.now() + (m ? Number(m[1]) * 1000 : 3600000) };
  return certs.keys;
}
const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
async function verifyGoogleToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, sig] = parts;
  const header = b64json(h), claims = b64json(p);
  if (header.alg !== 'RS256') throw new Error('Unexpected token type');
  let jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('Bad signature');
  const now = Date.now() / 1000;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Wrong issuer');
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('Token was issued for a different app');
  if (!(claims.exp > now - 60)) throw new Error('Token expired');
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Google email not verified');
  return claims;
}

/* ---------- sessions ---------- */
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
function sessionUser(req) {
  if (!AUTH_ON) return { email: 'anonymous', role: 'admin', open: true };
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = sha(m[1]), s = q.sess.get(h);
  if (!s || s.expires < Date.now()) { if (s) q.endSess.run(h); return null; }
  const u = q.user.get(s.email);
  if (!u) { q.endSess.run(h); return null; }               // removed from the access list
  if (s.expires - Date.now() < SESSION_MS - Math.min(15000, SESSION_MS / 4)) q.touch.run(Date.now() + SESSION_MS, h);   // any request counts as activity
  return { email: u.email, role: u.role, name: u.name, picture: u.picture, tokenHash: h };
}
function mayJoin(email) {
  if (q.user.get(email)) return true;
  const domain = email.split('@')[1] || '';
  return ALLOWED_DOMAINS.includes(domain);
}

/* ---------- http helpers ---------- */
function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const any = ALLOWED.includes('*');
  if (!any && !ALLOWED.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', any ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const text = await readBody(req, limit);
  try { return { text, obj: JSON.parse(text) }; } catch { throw Object.assign(new Error('Body must be JSON'), { status: 400 }); }
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      // lets the Google sign-in pop-up talk back to the page
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' });
    res.end(data);
  });
}

/* ---------- routes ---------- */
const failedLogins = new Map();   // ip -> {n, until}: slows down repeated failed sign-ins
async function handleAuth(req, res, parts, ip) {
  if (parts[1] === 'google' && req.method === 'POST') {
    if (!AUTH_ON) return json(res, 400, { error: 'Sign-in is not switched on for this server' });
    const f = failedLogins.get(ip);
    if (f && f.n >= 10 && f.until > Date.now()) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const { obj } = await readJson(req, 64 * 1024);
    let claims;
    try { claims = await verifyGoogleToken(obj.credential); }
    catch (e) {
      failedLogins.set(ip, { n: (f?.n || 0) + 1, until: Date.now() + 10 * 60000 });
      return json(res, 401, { error: 'Google sign-in could not be checked: ' + e.message });
    }
    const email = String(claims.email || '').toLowerCase();
    if (!mayJoin(email)) {
      console.log(`Refused sign-in from ${email}`);
      return json(res, 403, { error: `${email} isn't on the access list. Ask an admin to add you.`, email });
    }
    if (!q.user.get(email)) q.addUser.run(email, 'user', Date.now(), 'domain');
    q.seenUser.run(claims.name || null, claims.picture || null, Date.now(), email);
    const token = crypto.randomBytes(32).toString('base64url');
    q.newSess.run(sha(token), email, Date.now(), Date.now() + SESSION_MS);
    failedLogins.delete(ip);
    const u = q.user.get(email);
    return json(res, 200, { token, user: { email, role: u.role, name: u.name, picture: u.picture } });
  }
  const me = sessionUser(req);
  if (parts[1] === 'me' && req.method === 'GET') return me ? json(res, 200, { user: me.open ? null : { email: me.email, role: me.role, name: me.name, picture: me.picture }, auth: AUTH_ON }) : json(res, 401, { error: 'Not signed in' });
  if (parts[1] === 'logout' && req.method === 'POST') { if (me?.tokenHash) q.endSess.run(me.tokenHash); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'Unknown path' });
}

async function handleUsers(req, res, parts, me) {
  if (me.role !== 'admin') return json(res, 403, { error: 'Only admins can manage users' });
  const email = parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : null;
  if (!email && req.method === 'GET') return json(res, 200, { users: q.users.all(), admins: ADMIN_EMAILS, domains: ALLOWED_DOMAINS });
  if (!email) return json(res, 405, { error: 'Method not allowed' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'That is not an email address' });
  if (req.method === 'PUT') {
    const { obj } = await readJson(req, 4096);
    const role = obj.role === 'admin' ? 'admin' : 'user';
    if (ADMIN_EMAILS.includes(email) && role !== 'admin') return json(res, 400, { error: `${email} is an admin in the server settings and stays an admin` });
    const existing = q.user.get(email);
    if (existing?.role === 'admin' && role !== 'admin' && q.admins.get().n <= 1) return json(res, 400, { error: 'There must be at least one admin' });
    q.addUser.run(email, role, Date.now(), me.email);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'DELETE') {
    if (ADMIN_EMAILS.includes(email)) return json(res, 400, { error: `${email} is an admin in the server settings and can't be removed here` });
    if (email === me.email) return json(res, 400, { error: "You can't remove yourself" });
    q.delUser.run(email); q.endUser.run(email);
    return json(res, 200, { ok: true });
  }
  return json(res, 405, { error: 'Method not allowed' });
}

/* ---------- who may change what ----------
   Sites and plans belong to whoever created them. Users change and delete only their own;
   admins change anything. A plan's images and undo history follow the plan's owner.
   Shared settings (station types, heading, logo) can be created by anyone but changed only by admins. */
const OWNED = new Set(['sites', 'maps']);
function writeCheck(me, store, id, method) {
  if (me.open || me.role === 'admin') return null;
  const ownerOf = (st, key) => { const r = q.row.get(st, key); return r ? { owner: r.owner } : null; };
  let rec = null, what = 'This';
  if (OWNED.has(store)) { rec = ownerOf(store, id); what = store === 'sites' ? 'This site' : 'This plan'; }
  else if (store === 'assets') { rec = ownerOf('maps', id); what = 'This plan'; }
  else if (store === 'meta' && id.startsWith('hist:')) { rec = ownerOf('maps', id.slice(5)); what = 'This plan'; }
  else if (store === 'meta') { return q.row.get('meta', id) ? 'Only admins can change shared settings.' : null; }
  if (!rec) return null;                                   // new record: allowed, and it becomes theirs
  if (rec.owner === me.email) return null;
  return `${what} belongs to ${rec.owner || 'an admin'}. You can open it and make your own copy, but only the owner or an admin can change it.`;
}

const server = http.createServer(async (req, res) => {
  try {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
      return serveStatic(res, url.pathname);
    }

    const parts = url.pathname.slice(5).split('/').filter(Boolean).map(s => decodeURIComponent(s));
    if (parts[0] === 'health' && parts.length === 1) {
      const me = sessionUser(req);
      const out = { ok: true, app: 'station-planner', auth: AUTH_ON ? { google: GOOGLE_CLIENT_ID } : null };
      if (me) out.counts = Object.fromEntries(q.counts.all().map(r => [r.store, r.n]));
      return json(res, 200, out);
    }
    if (parts[0] === 'auth') return await handleAuth(req, res, parts, ip);

    const me = sessionUser(req);
    if (!me) return json(res, 401, { error: 'Please sign in' });
    if (parts[0] === 'users') return await handleUsers(req, res, parts, me);
    if (parts[0] === 'people' && req.method === 'GET') return json(res, 200, AUTH_ON ? q.people.all() : []);

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
    if (req.method === 'PUT' || req.method === 'DELETE') {
      const deny = writeCheck(me, store, id, req.method);
      if (deny) return json(res, 403, { error: deny });
    }
    if (req.method === 'PUT') {
      const { text, obj } = await readJson(req);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.id !== id) return json(res, 400, { error: 'The record id must match the address' });
      let body = text;
      if (OWNED.has(store)) {
        // the server decides the owner: whoever first created it (never changed by later edits, even an admin's)
        const ex = q.row.get(store, id);
        const owner = ex ? ex.owner : (me.open ? null : me.email);
        obj.owner = owner || undefined;
        body = JSON.stringify(obj);
        q.put.run(store, id, typeof obj.siteId === 'string' ? obj.siteId : null, body, Date.now());
        if (!ex) q.setOwner.run(owner, store, id);
      } else q.put.run(store, id, typeof obj.siteId === 'string' ? obj.siteId : null, body, Date.now());
      return json(res, 200, { ok: true, owner: obj.owner || null });
    }
    if (req.method === 'DELETE') {
      q.del.run(store, id);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    const code = e.status || 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: code === 413 ? 'Upload too large' : code === 400 ? e.message : 'Server error' });
  }
});

server.listen(PORT, HOST, () => console.log(`Station Planner server listening on http://${HOST}:${PORT} (database ${DB_PATH}); sign-in ${AUTH_ON ? 'ON (Google)' : 'OFF'}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
