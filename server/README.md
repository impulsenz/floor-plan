# Station Planner server on Oracle Cloud

The app saves every site, plan, image and setting to this server, so plans are the same on every device.
The server is one small Node.js program with an SQLite database, behind Caddy for HTTPS.

> **Sign-in:** the server starts with sign-in **off**. Switch on Google sign-in with the steps in *Google sign-in* below, so only people you approve can get in.

## What you need

- An Oracle Cloud **compute instance** (the Always Free *VM.Standard.A1.Flex* or *VM.Standard.E2.1.Micro* is fine) running **Canonical Ubuntu 22.04/24.04** or **Oracle Linux 8/9**, with a **public IP address**.
- The SSH private key you downloaded when you created the instance.

## Step 1: Open ports 80 and 443 in Oracle Cloud

Oracle blocks web traffic until you allow it.

1. In the Oracle Cloud console, open **Compute → Instances** and click your instance.
2. Under **Primary VNIC**, click the **Subnet** link, then the **Default Security List** (or the security list attached to that subnet).
3. Click **Add Ingress Rules** and add **two** rules:

   | Source CIDR | IP Protocol | Destination Port Range |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

4. Click **Add Ingress Rules** to save.

(If your subnet uses a Network Security Group instead, add the same two rules there.)

## Step 2: Connect to the instance

From your computer (PowerShell on Windows, Terminal on Mac):

```
ssh -i path/to/your-private-key.key ubuntu@YOUR_PUBLIC_IP
```

Use `opc@YOUR_PUBLIC_IP` instead of `ubuntu@` if the instance runs Oracle Linux.

## Step 3: Run the setup script

Paste these two lines into the SSH session:

```
curl -fsSL https://raw.githubusercontent.com/impulsenz/floor-plan/main/server/setup-floorplan-server.sh -o setup-floorplan-server.sh
sudo bash setup-floorplan-server.sh
```

It takes 2–5 minutes. When it finishes it prints your address, for example:

```
 Station Planner is live:   https://140-238-12-34.sslip.io
```

The address is your public IP with dashes plus `.sslip.io`, a free service that gives every IP a name so it can have an HTTPS certificate. If you own a domain, point an **A record** at the instance's IP and run `sudo bash setup-floorplan-server.sh plans.yourdomain.co.nz` instead.

## Step 4: Open the app

Open the printed address in your browser. The server serves the app itself, so that's all you need, on any device.

To keep using the GitHub Pages copy (or a downloaded `index.html`), open it once with the server address added, and it's remembered:

```
https://impulsenz.github.io/floor-plan/?api=https://140-238-12-34.sslip.io
```

You can also change the address any time with the **Server** button on the Sites page.

## Step 5: Move your existing plans to the server

Plans you made before the server existed are still in the browser where you made them.

1. Open the app **in that same browser, at the same address you used before** (the GitHub Pages link, or the downloaded file), with `?api=…` added as above.
2. On the Sites page, click **Server**, then **Copy them to the server**.

Anything already on the server is left as it is, so it's safe to run again.

## Google sign-in

Once this is on, people sign in with their Google account. Only accounts on your access list (or from a company domain you allow) get in, and anyone is signed out after **5 minutes without activity**.

### A. Create a Google sign-in ID (Google Cloud website)

1. Go to **console.cloud.google.com** and sign in with your Google account.
2. Click the project picker at the top → **New project** → name it `Station Planner` → **Create**. Make sure the new project is selected at the top.
3. Open **☰ → APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**) → **Get started**.
   - **App name:** `Station Planner`. **User support email:** your email → **Next**.
   - **Audience:** **External** → **Next**.
   - **Contact information:** your email → **Next** → tick the agreement → **Create**.
4. Go to **Audience** in the left menu → **Publish app** → **Confirm**. This lets anyone *try* to sign in; the server still only lets in people on your list. No Google review is needed, because the app only asks for name and email.
5. Go to **Clients** (or **Credentials**) → **Create client**:
   - **Application type:** **Web application**. **Name:** `Station Planner`.
   - **Authorized JavaScript origins** → **Add URI**: your server address exactly, e.g. `https://140-238-12-34.sslip.io` (no slash at the end). Add `https://impulsenz.github.io` as well if you use the GitHub Pages copy.
   - Leave **Authorized redirect URIs** empty → **Create**.
6. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`. You don't need the client secret.

### B. Switch it on (on the server)

SSH in as before, then run, using your Client ID and email:

```
curl -fsSL https://raw.githubusercontent.com/impulsenz/floor-plan/main/server/setup-floorplan-server.sh -o setup.sh
sudo bash setup.sh --google-client-id 1234-abc.apps.googleusercontent.com --admin you@gmail.com
```

Optional: add `--allow-domain yourcompany.co.nz` to let every Google account at that domain in without adding them one by one. Several admins can be listed with commas.

### C. Sign in and add people

1. Open your server address. You'll see **Sign in with Google**. Sign in with the admin email.
2. Click your picture (top right) → **Users and access** → type someone's Google email → **Add**. Choose **Admin** if they should be able to manage users too.
3. Removing someone signs them out straight away.

New Google sign-in IDs can take a few minutes to start working. If the button says the origin isn't allowed, wait 5–10 minutes, then check the address in step A5 matches exactly.

To switch sign-in off again: `sudo bash setup.sh --no-auth`.

## Looking after the server

| Task | Command |
|---|---|
| Update the app to the latest version | re-run `sudo bash setup-floorplan-server.sh` |
| See the server's log | `sudo journalctl -u floorplan -f` |
| Restart the server | `sudo systemctl restart floorplan` |
| Check it's running | `curl https://YOUR-ADDRESS/api/health` |

- **Database:** `/var/lib/floorplan/floorplan.db`
- **Backups:** made every night to `/var/backups/floorplan`, and the last 14 days are kept. To restore one, stop the server (`sudo systemctl stop floorplan`), copy the backup over the database file, then start it again.

## Troubleshooting

- **The setup script says HTTPS isn't answering.** Ports 80/443 aren't open in Step 1. Fix the rules, then run `sudo systemctl restart caddy`.
- **The app says it can't reach the server.**
  - Check the address starts with `https://`.
  - Open `https://YOUR-ADDRESS/api/health` in the browser; it should show `"ok":true`.
- **Certificate errors with sslip.io.** Let's Encrypt occasionally rate-limits shared names. Wait an hour and restart Caddy, or use your own domain.

## How it fits together

```
browser ──HTTPS──► Caddy (ports 80/443, certificates) ──► Node server (127.0.0.1:8080) ──► SQLite file
```

API (all JSON; `{store}` is `sites`, `maps`, `assets` or `meta`):

| Method | Path | Does |
|---|---|---|
| GET | `/api/health` | `{ok, app, auth}` (+ `counts` when signed in) |
| POST | `/api/auth/google` | swap a Google ID token for a session token |
| GET / POST | `/api/auth/me`, `/api/auth/logout` | who's signed in / sign out |
| GET / PUT / DELETE | `/api/users[/{email}]` | access list (admins only) |
| GET / PUT | `/api/prefs` | your own settings (theme, defaults), stored per account |
| GET | `/api/maps?summary=1[&siteId=]` | plan list without drawing data (for site pages) |
| GET | `/api/info/{planId}` | sizes and last-saved times of a plan's drawing, pictures and undo history |
| POST / GET | `/api/links`, `/api/dl/{key}` | make a 10-minute link that downloads one plan without signing in (for testing) |
| GET | `/api/{store}` | every record (`?siteId=` filters plans by site) |
| GET | `/api/{store}/{id}` | one record, or 404 |
| PUT | `/api/{store}/{id}` | create or replace (body `id` must match) |
| DELETE | `/api/{store}/{id}` | remove |

Settings live in `/etc/systemd/system/floorplan.service`. `ALLOWED_ORIGINS` limits which web addresses may use the server (for example `https://impulsenz.github.io`), and is `*` (any) for now.

Every GET answers with an `ETag`; send it back as `If-None-Match` and an unchanged record or list comes back as `304 Not Modified` with no body, so browsers re-use their own copy. A PUT returns the new `etag`.

Sites and plans record an `owner` (the email of whoever created them). Only the owner or an admin may change or delete them; images and history follow their plan's owner. Records made before ownership existed have no owner, so only admins can change those. `GET /api/people` lists names for showing who owns what.

With sign-in on, every `/api/{store}` and `/api/users` call needs `Authorization: Bearer <token>`. The token comes from `POST /api/auth/google {credential}` (a Google ID token, checked against Google's signing keys and your client ID). Only a hash of each token is stored, and tokens expire after `SESSION_MINUTES` (5) without activity. Each account has one session at a time: a new sign-in ends the old one, and the old browser is told it was signed in elsewhere. `/etc/floorplan.env` holds `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `ALLOWED_DOMAINS`, `ALLOWED_ORIGINS` and `SESSION_MINUTES`; restart with `sudo systemctl restart floorplan` after editing it.
