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
  CREATE TABLE IF NOT EXISTS replaced_sessions (
    token_hash TEXT PRIMARY KEY,       -- sessions ended because the same account signed in somewhere else
    ended      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS access_requests (
    id         TEXT PRIMARY KEY,
    store      TEXT NOT NULL,          -- sites | maps
    rec_id     TEXT NOT NULL,
    name       TEXT,                   -- site or plan name, for the list
    site_id    TEXT,
    requester  TEXT NOT NULL,
    req_name   TEXT,
    owner      TEXT,                   -- who decides (null = admins)
    note       TEXT,
    status     TEXT NOT NULL,          -- pending | approved | denied | revoked
    created    INTEGER NOT NULL,
    decided    INTEGER,
    decided_by TEXT,
    seen       INTEGER NOT NULL DEFAULT 0   -- the requester has seen the decision
  );
  CREATE TABLE IF NOT EXISTS grants (
    store   TEXT NOT NULL,             -- edit access someone else was given: to a site (and all its plans) or one plan
    rec_id  TEXT NOT NULL,
    email   TEXT NOT NULL,
    PRIMARY KEY (store, rec_id, email)
  );
  CREATE TABLE IF NOT EXISTS prefs (
    email   TEXT PRIMARY KEY,          -- each person's own settings (theme etc.), so they follow them to any device
    data    TEXT NOT NULL,
    updated INTEGER NOT NULL
  );
`);

// Who created each site or plan. Older records (from before ownership) have no owner and only admins can change them.
if (!db.prepare("SELECT 1 FROM pragma_table_info('records') WHERE name = 'owner'").get()) db.exec('ALTER TABLE records ADD COLUMN owner TEXT');

// a light listing of plans for the site pages: no drawing data, just what the cards need
const SUMMARY = `SELECT json_object('id', id, 'siteId', site_id, 'name', json_extract(data, '$.name'), 'updated', json_extract(data, '$.updated'),
  'created', json_extract(data, '$.created'), 'owner', json_extract(data, '$.owner'), 'thumb', json_extract(data, '$.thumb'),
  'settings', json_object('department', json_extract(data, '$.settings.department'), 'preparedBy', json_extract(data, '$.settings.preparedBy'), 'revision', json_extract(data, '$.settings.revision'))) AS data
  FROM records WHERE store = 'maps'`;
const q = {
  list:     db.prepare('SELECT data FROM records WHERE store = ? ORDER BY updated DESC'),
  listSite: db.prepare('SELECT data FROM records WHERE store = ? AND site_id = ? ORDER BY updated DESC'),
  get:      db.prepare('SELECT data, updated FROM records WHERE store = ? AND id = ?'),
  stamp:    db.prepare('SELECT updated FROM records WHERE store = ? AND id = ?'),
  size:     db.prepare('SELECT length(CAST(data AS BLOB)) AS size, updated FROM records WHERE store = ? AND id = ?'),
  ver:      db.prepare('SELECT COUNT(*) AS n, MAX(updated) AS m FROM records WHERE store = ?'),
  verSite:  db.prepare('SELECT COUNT(*) AS n, MAX(updated) AS m FROM records WHERE store = ? AND site_id = ?'),
  sum:      db.prepare(SUMMARY + ' ORDER BY updated DESC'),
  sumSite:  db.prepare(SUMMARY + ' AND site_id = ? ORDER BY updated DESC'),
  row:      db.prepare('SELECT owner, site_id FROM records WHERE store = ? AND id = ?'),
  grant:    db.prepare('SELECT 1 FROM grants WHERE store = ? AND rec_id = ? AND email = ?'),
  myGrants: db.prepare('SELECT store, rec_id AS id FROM grants WHERE email = ?'),
  addGrant: db.prepare('INSERT OR IGNORE INTO grants (store, rec_id, email) VALUES (?, ?, ?)'),
  delGrant: db.prepare('DELETE FROM grants WHERE store = ? AND rec_id = ? AND email = ?'),
  reqNew:   db.prepare(`INSERT INTO access_requests (id, store, rec_id, name, site_id, requester, req_name, owner, note, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`),
  reqOpen:  db.prepare("SELECT id FROM access_requests WHERE store = ? AND rec_id = ? AND requester = ? AND status = 'pending'"),
  reqGet:   db.prepare('SELECT * FROM access_requests WHERE id = ?'),
  reqFor:   db.prepare("SELECT * FROM access_requests WHERE (owner = ? OR ?) AND status IN ('pending', 'approved') ORDER BY created DESC LIMIT 300"),
  reqMine:  db.prepare('SELECT * FROM access_requests WHERE requester = ? AND created > ? ORDER BY created DESC LIMIT 100'),
  reqSet:   db.prepare('UPDATE access_requests SET status = ?, decided = ?, decided_by = ?, seen = 0 WHERE id = ?'),
  reqSeen:  db.prepare("UPDATE access_requests SET seen = 1 WHERE requester = ? AND status != 'pending'"),
  reqCount: db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending' AND (owner = ? OR ?)"),
  reqNews:  db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE requester = ? AND status != 'pending' AND seen = 0"),
  setOwner: db.prepare('UPDATE records SET owner = ? WHERE store = ? AND id = ?'),
  people:   db.prepare('SELECT email, name FROM users'),
  prefs:    db.prepare('SELECT data FROM prefs WHERE email = ?'),
  setPrefs: db.prepare('INSERT INTO prefs (email, data, updated) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET data = excluded.data, updated = excluded.updated'),
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
  replace:  db.prepare('INSERT OR REPLACE INTO replaced_sessions (token_hash, ended) SELECT token_hash, ? FROM sessions WHERE email = ?'),
  replaced: db.prepare('SELECT 1 FROM replaced_sessions WHERE token_hash = ?'),
  tidyRepl: db.prepare('DELETE FROM replaced_sessions WHERE ended < ?'),
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
  if (!s && q.replaced.get(h)) { req.authWhy = 'elsewhere'; return null; }
  if (!s || s.expires < Date.now()) { if (s) q.endSess.run(h); return null; }
  const u = q.user.get(s.email);
  if (!u) { q.endSess.run(h); return null; }               // removed from the access list
  if (s.expires - Date.now() < SESSION_MS - Math.min(15000, SESSION_MS / 4)) q.touch.run(Date.now() + SESSION_MS, h);   // any request counts as activity
  return { email: u.email, role: u.role, name: u.name, picture: u.picture, tokenHash: h };
}
const ELSEWHERE = 'Your account was signed in on another browser or device, so it has been signed out here. Only one sign-in at a time is allowed.';
const notSignedIn = (req, res) => json(res, 401, req.authWhy === 'elsewhere' ? { error: ELSEWHERE, code: 'elsewhere' } : { error: 'Please sign in' });
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function send(res, code, body, type = 'application/json; charset=utf-8', etag) {
  const h = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (etag) h.ETag = etag;
  res.writeHead(code, h);
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
/* ---------- live editing ----------
   Everyone with a plan open keeps one stream open to the server (server-sent events). Changes one person
   makes are passed straight on to the others on that plan; nothing extra is stored. */
const live = new Map();          // planId -> Map(clientId -> {res, email, name, picture, joined})
const COLOURS = ['#e8590c', '#1971c2', '#2b8a3e', '#c2255c', '#6741d9', '#0c8599', '#f08c00', '#5c940d'];
function livePeers(planId) { const room = live.get(planId); return room ? [...room].map(([id, c]) => ({ id, email: c.email, name: c.name, picture: c.picture, colour: c.colour, edit: c.edit })) : []; }
function liveSend(c, msg) { try { c.res.write(`data: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n\n`); } catch {} }
function liveCast(planId, msg, except, only) { const room = live.get(planId); if (!room) return; const txt = JSON.stringify(msg); for (const [id, c] of room) if (id !== except && (!only || id === only)) liveSend(c, txt); }
setInterval(() => { for (const [planId, room] of live) for (const [id, c] of room) { if (c.check()) liveSend(c, '{"type":"ping"}'); else { try { c.res.end(); } catch {} room.delete(id); liveCast(planId, { type: 'peers', peers: livePeers(planId) }); } } }, 25000).unref();
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
    // one sign-in at a time: signing in here ends this account's session in any other browser
    q.tidyRepl.run(Date.now() - 2 * 86400000);
    q.replace.run(Date.now(), email); q.endUser.run(email);
    q.newSess.run(sha(token), email, Date.now(), Date.now() + SESSION_MS);
    failedLogins.delete(ip);
    const u = q.user.get(email);
    return json(res, 200, { token, user: { email, role: u.role, name: u.name, picture: u.picture } });
  }
  const me = sessionUser(req);
  if (parts[1] === 'me' && req.method === 'GET') return me ? json(res, 200, { user: me.open ? null : { email: me.email, role: me.role, name: me.name, picture: me.picture }, auth: AUTH_ON,
      requests: me.open ? 0 : q.reqCount.get(me.email, me.role === 'admin' ? 1 : 0).n, decisions: me.open ? 0 : q.reqNews.get(me.email).n }) : notSignedIn(req, res);
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

async function handleRequests(req, res, parts, me) {
  const admin = me.role === 'admin' ? 1 : 0;
  if (parts.length === 1 && req.method === 'GET') {
    const out = { incoming: q.reqFor.all(me.email, admin), mine: q.reqMine.all(me.email, Date.now() - 30 * 86400000) };
    q.reqSeen.run(me.email);
    return json(res, 200, out);
  }
  if (parts.length === 1 && req.method === 'POST') {
    if (me.open) return json(res, 400, { error: 'Sign-in is off, so everyone can already edit everything' });
    const { obj } = await readJson(req, 8192);
    const store = obj?.store === 'sites' ? 'sites' : obj?.store === 'maps' ? 'maps' : null, id = String(obj?.id || '');
    if (!store || !id) return json(res, 400, { error: 'Say which site or plan' });
    const r = q.row.get(store, id), data = q.get.get(store, id);
    if (!r || !data) return json(res, 404, { error: 'That is no longer on the server' });
    if (r.owner === me.email || admin) return json(res, 400, { error: 'You can already edit this' });
    if (q.grant.get(store, id, me.email) || (store === 'maps' && r.site_id && q.grant.get('sites', r.site_id, me.email))) return json(res, 400, { error: 'You can already edit this' });
    if (q.reqOpen.get(store, id, me.email)) return json(res, 200, { ok: true, already: true });
    let name = null; try { name = JSON.parse(data.data).name || null; } catch {}
    q.reqNew.run('r' + crypto.randomBytes(9).toString('base64url'), store, id, name, store === 'maps' ? r.site_id : id, me.email, me.name || null, r.owner || null, String(obj.note || '').slice(0, 500) || null, Date.now());
    return json(res, 200, { ok: true });
  }
  if (parts.length === 2 && req.method === 'POST') {
    const rq = q.reqGet.get(parts[1]);
    if (!rq) return json(res, 404, { error: 'That request no longer exists' });
    const owner = q.row.get(rq.store, rq.rec_id)?.owner ?? rq.owner;
    if (!admin && owner !== me.email) return json(res, 403, { error: 'Only the owner or an admin can decide this' });
    const { obj } = await readJson(req, 2048), d = obj?.decision;
    if (d === 'approve') { q.addGrant.run(rq.store, rq.rec_id, rq.requester); q.reqSet.run('approved', Date.now(), me.email, rq.id); }
    else if (d === 'deny') { q.reqSet.run('denied', Date.now(), me.email, rq.id); }
    else if (d === 'revoke') { q.delGrant.run(rq.store, rq.rec_id, rq.requester); q.reqSet.run('revoked', Date.now(), me.email, rq.id); }
    else return json(res, 400, { error: 'Decision must be approve, deny or revoke' });
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
  const ownerOf = (st, key) => { const r = q.row.get(st, key); return r ? { owner: r.owner, site_id: r.site_id } : null; };
  let rec = null, what = 'This';
  if (OWNED.has(store)) { rec = ownerOf(store, id); what = store === 'sites' ? 'This site' : 'This plan'; }
  else if (store === 'assets') { rec = ownerOf('maps', id); what = 'This plan'; }
  else if (store === 'meta' && id.startsWith('hist:')) { rec = ownerOf('maps', id.slice(5)); what = 'This plan'; }
  else if (store === 'meta') { return q.row.get('meta', id) ? 'Only admins can change shared settings.' : null; }
  if (!rec) return null;                                   // new record: allowed, and it becomes theirs
  if (rec.owner === me.email) return null;
  // edit access the owner (or an admin) approved: to this plan, or to the whole site. Deleting stays with the owner.
  if (method !== 'DELETE' || store === 'assets' || store === 'meta') {
    const planId = store === 'maps' ? id : store === 'assets' ? id : store === 'meta' ? id.slice(5) : null;
    if (store === 'sites' && q.grant.get('sites', id, me.email)) return null;
    if (planId) { const pr = q.row.get('maps', planId); if (q.grant.get('maps', planId, me.email) || (pr?.site_id && q.grant.get('sites', pr.site_id, me.email))) return null; }
  }
  if (method === 'DELETE' && (store === 'sites' || store === 'maps')) {
    const g = store === 'sites' ? q.grant.get('sites', id, me.email) : (q.grant.get('maps', id, me.email) || (rec.site_id && q.grant.get('sites', rec.site_id, me.email)));
    if (g) return `You can edit this, but only ${rec.owner || 'an admin'} or an admin can delete it.`;
  }
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
    if (!me) return notSignedIn(req, res);
    if (parts[0] === 'users') return await handleUsers(req, res, parts, me);
    if (parts[0] === 'people' && req.method === 'GET') return json(res, 200, AUTH_ON ? q.people.all() : []);
    if (parts[0] === 'prefs' && parts.length === 1) {
      if (req.method === 'GET') { const r = q.prefs.get(me.email); return send(res, 200, r ? r.data : '{}'); }
      if (req.method === 'PUT') {
        const { obj } = await readJson(req, 64 * 1024);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return json(res, 400, { error: 'Settings must be an object' });
        q.setPrefs.run(me.email, JSON.stringify(obj), Date.now());
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }

    // ----- live editing -----
    if (parts[0] === 'live' && parts.length === 2) {
      const planId = parts[1], row = q.row.get('maps', planId);
      if (!row) return json(res, 404, { error: 'That plan is not on the server' });
      if (req.method === 'GET') {
        const clientId = String(url.searchParams.get('c') || '').slice(0, 40) || crypto.randomBytes(6).toString('base64url');
        const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1] || '';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        if (!live.has(planId)) live.set(planId, new Map());
        const room = live.get(planId), used = new Set([...room.values()].map(c => c.colour));
        const c = { res, email: me.email, name: me.name || me.email.split('@')[0], picture: me.picture || null, colour: COLOURS.find(x => !used.has(x)) || COLOURS[room.size % COLOURS.length],
          edit: !writeCheck(me, 'maps', planId, 'PUT'), check: () => { if (me.open) return true; const s0 = q.sess.get(sha(token)); return !!s0 && s0.expires > Date.now() && !!q.user.get(s0.email); } };   // checking doesn't count as activity
        const first = [...room].find(([, x]) => x.edit)?.[0];
        room.set(clientId, c);
        liveSend(c, { type: 'hello', you: clientId, colour: c.colour, peers: livePeers(planId) });
        liveCast(planId, { type: 'peers', peers: livePeers(planId) }, clientId);
        if (first) liveCast(planId, { type: 'need-state', for: clientId }, null, first);     // the person who was here first sends the latest version
        req.on('close', () => { room.delete(clientId); if (!room.size) live.delete(planId); else liveCast(planId, { type: 'peers', peers: livePeers(planId) }); });
        return;
      }
      if (req.method === 'POST') {
        const { obj } = await readJson(req, 20 * 1024 * 1024);
        const from = String(obj?.from || ''), room = live.get(planId);
        if (!room?.has(from)) return json(res, 409, { error: 'Not connected to this plan' });
        if (obj.type === 'cursor') {     // pointer position, plus whatever they're in the middle of drawing
          const draft = obj.draft && JSON.stringify(obj.draft).length < 60000 ? obj.draft : null;
          liveCast(planId, { type: 'cursor', from, x: +obj.x || 0, y: +obj.y || 0, on: !!obj.on, draft }, from); return json(res, 200, { ok: true }); }
        const deny = writeCheck(me, 'maps', planId, 'PUT');
        if (deny) return json(res, 403, { error: deny });
        if (obj.type === 'ops') liveCast(planId, { type: 'ops', from, by: me.name || me.email, ops: obj.ops }, from);
        else if (obj.type === 'state' && obj.to) liveCast(planId, { type: 'state', from, state: obj.state }, from, String(obj.to));
        else return json(res, 400, { error: 'Unknown message' });
        return json(res, 200, { ok: true, peers: room.size - 1 });
      }
      return json(res, 405, { error: 'Method not allowed' });
    }
    // ----- asking for edit access to someone else's site or plan -----
    if (parts[0] === 'grants' && parts.length === 1 && req.method === 'GET') return json(res, 200, me.open ? [] : q.myGrants.all(me.email));
    if (parts[0] === 'requests') return await handleRequests(req, res, parts, me);
    // sizes of what is saved for one plan
    if (parts[0] === 'info' && parts.length === 2 && req.method === 'GET') {
      const id = parts[1], one = st => { const r = q.size.get(st[0], st[1]); return r ? { size: r.size, updated: r.updated } : null; };
      const map = one(['maps', id]);
      if (!map) return json(res, 404, { error: 'Not found' });
      return json(res, 200, { map, assets: one(['assets', id]), hist: one(['meta', 'hist:' + id]) });
    }
    const [store, id] = parts;
    if (!STORES.has(store) || parts.length > 2) return json(res, 404, { error: 'Unknown path' });

    if (!id) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      // unchanged since the browser last fetched it? answer "not modified" with no body, to save data
      const siteId = url.searchParams.get('siteId'), summary = store === 'maps' && url.searchParams.has('summary');
      const v = siteId ? q.verSite.get(store, siteId) : q.ver.get(store), etag = `"${summary ? 's' : 'f'}${v.n}-${v.m || 0}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      const rows = summary ? (siteId ? q.sumSite.all(siteId) : q.sum.all()) : (siteId ? q.listSite.all(store, siteId) : q.list.all(store));
      return send(res, 200, '[' + rows.map(r => r.data).join(',') + ']', undefined, etag);
    }
    if (id.length > 200) return json(res, 400, { error: 'Bad id' });

    if (req.method === 'GET') {
      const st = q.stamp.get(store, id);
      if (!st) return json(res, 404, { error: 'Not found' });
      const etag = `"r${st.updated}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      return send(res, 200, q.get.get(store, id).data, undefined, etag);
    }
    if (req.method === 'PUT' || req.method === 'DELETE') {
      const deny = writeCheck(me, store, id, req.method);
      if (deny) return json(res, 403, { error: deny });
    }
    if (req.method === 'PUT') {
      const { text, obj } = await readJson(req);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.id !== id) return json(res, 400, { error: 'The record id must match the address' });
      let body = text;
      let now = Date.now(); const prev = q.stamp.get(store, id); if (prev && prev.updated >= now) now = prev.updated + 1;
      if (OWNED.has(store)) {
        // the server decides the owner: whoever first created it (never changed by later edits, even an admin's)
        const ex = q.row.get(store, id);
        const owner = ex ? ex.owner : (me.open ? null : me.email);
        obj.owner = owner || undefined;
        body = JSON.stringify(obj);
        q.put.run(store, id, typeof obj.siteId === 'string' ? obj.siteId : null, body, now);
        if (!ex) q.setOwner.run(owner, store, id);
      } else q.put.run(store, id, typeof obj.siteId === 'string' ? obj.siteId : null, body, now);
      // the new version tag lets the browser keep its own copy instead of downloading it again
      return json(res, 200, { ok: true, owner: obj.owner || null, etag: `"r${now}"` });
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
