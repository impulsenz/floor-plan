#!/usr/bin/env bash
# =====================================================================
#  Station Planner server setup for an Oracle Cloud (OCI) compute VM
#  Works on Canonical Ubuntu 22.04/24.04 and Oracle Linux 8/9 (x86 or Ampere Arm).
#
#  Usage:   sudo bash setup-floorplan-server.sh [your-domain]
#  Re-run it any time to update the app to the latest version from GitHub.
#
#  What it does:
#    - installs Node.js 24, SQLite and the Caddy web server
#    - installs the Station Planner server + app in /opt/floorplan
#    - keeps the database in /var/lib/floorplan/floorplan.db
#    - gets a free HTTPS certificate (uses <your-ip>.sslip.io if no domain is given)
#    - opens ports 80 and 443 in the VM's own firewall
#    - backs the database up every night to /var/backups/floorplan (14 days kept)
#
#  NOTE: there is no login yet. Anyone with the address can read and change plans.
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/floorplan
DATA_DIR=/var/lib/floorplan
BACKUP_DIR=/var/backups/floorplan
REPO_RAW=https://raw.githubusercontent.com/impulsenz/floor-plan/main
PORT=8080

say(){ printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo:  sudo bash $0"
if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
else die "This script supports Ubuntu (apt) and Oracle Linux (dnf) only."; fi

node_ok(){ command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }

install_caddy_binary(){
  say "Installing Caddy from caddyserver.com"
  local arch; case "$(uname -m)" in aarch64|arm64) arch=arm64;; *) arch=amd64;; esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${arch}" -o /usr/bin/caddy
  chmod +x /usr/bin/caddy
  id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell "$(command -v nologin)" caddy
  mkdir -p /etc/caddy
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
}

say "Installing packages (this takes a few minutes the first time)"
if [ "$PM" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https
  if ! node_ok; then curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; apt-get install -y nodejs; fi
  if ! command -v caddy >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy || install_caddy_binary
  fi
else
  dnf install -y curl sqlite cronie
  systemctl enable --now crond || true
  if ! node_ok; then curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -; dnf install -y nodejs; fi
  if ! command -v caddy >/dev/null 2>&1; then
    { dnf install -y 'dnf-command(copr)' && dnf copr enable -y @caddy/caddy && dnf install -y caddy; } || install_caddy_binary
  fi
fi
node_ok || die "Node.js 22.13 or newer is needed but could not be installed."
NODE_BIN="$(command -v node)"
echo "Node $(node -v), Caddy $(caddy version | head -1)"

say "Installing the Station Planner app"
id floorplan >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell "$(command -v nologin)" floorplan
mkdir -p "$APP_DIR/public" "$DATA_DIR" "$BACKUP_DIR"

cat > "$APP_DIR/server.mjs" <<'SERVER_EOF'
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
SERVER_EOF

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/index.html" ]; then
  cp "$SCRIPT_DIR/index.html" "$APP_DIR/public/index.html"; echo "Using index.html next to this script"
else
  curl -fsSL "$REPO_RAW/index.html" -o "$APP_DIR/public/index.html"; echo "Downloaded the latest index.html from GitHub"
fi
chown -R floorplan:floorplan "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

cat > /etc/systemd/system/floorplan.service <<UNIT
[Unit]
Description=Station Planner server
After=network.target

[Service]
User=floorplan
Group=floorplan
Environment=PORT=${PORT}
Environment=HOST=127.0.0.1
Environment=DB_PATH=${DATA_DIR}/floorplan.db
Environment=PUBLIC_DIR=${APP_DIR}/public
# Comma-separated list of web addresses allowed to use this server, or * for any.
Environment=ALLOWED_ORIGINS=*
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning ${APP_DIR}/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable floorplan >/dev/null
systemctl restart floorplan
sleep 2
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || { journalctl -u floorplan -n 30 --no-pager; die "The app server did not start (log above)."; }
echo "App server is running."

say "Opening ports 80 and 443 in the VM firewall"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
  echo "firewalld updated"
elif command -v iptables >/dev/null 2>&1; then
  for p in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true
  else mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4; fi
  echo "iptables updated"
fi

say "Setting up HTTPS"
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://ifconfig.me || true)"
if [ -z "$DOMAIN" ]; then
  [ -n "$PUBLIC_IP" ] || die "Could not find this VM's public IP. Re-run with a domain: sudo bash $0 plans.example.com"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
[ -f /etc/caddy/Caddyfile ] && [ ! -f /etc/caddy/Caddyfile.before-floorplan ] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-floorplan
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:${PORT}
}
CADDY
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

say "Nightly database backup"
cat > /etc/cron.daily/floorplan-backup <<BACKUP
#!/bin/sh
sqlite3 ${DATA_DIR}/floorplan.db ".backup '${BACKUP_DIR}/floorplan-\$(date +%F).db'"
find ${BACKUP_DIR} -name 'floorplan-*.db' -mtime +14 -delete
BACKUP
chmod +x /etc/cron.daily/floorplan-backup
echo "Backups go to ${BACKUP_DIR}"

say "Checking HTTPS (can take up to a minute while the certificate is issued)"
ok=0
for i in $(seq 1 20); do
  if curl -fsS --max-time 10 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done

echo
echo "====================================================================="
if [ "$ok" = 1 ]; then
  echo " Station Planner is live:   https://${DOMAIN}"
else
  echo " The app is installed, but https://${DOMAIN} is not answering yet."
  echo " Most likely ports 80/443 are not open in the Oracle Cloud console"
  echo " (Networking > Virtual cloud networks > your VCN > Security Lists)."
  echo " Fix that, then run:  sudo systemctl restart caddy"
fi
echo
echo " Use it from GitHub Pages or a downloaded copy by opening it once with:"
echo "   ?api=https://${DOMAIN}"
echo " e.g. https://impulsenz.github.io/floor-plan/?api=https://${DOMAIN}"
echo
echo " Logs:     sudo journalctl -u floorplan -f"
echo " Database: ${DATA_DIR}/floorplan.db   Backups: ${BACKUP_DIR}"
echo " Update:   re-run this script"
echo "====================================================================="
