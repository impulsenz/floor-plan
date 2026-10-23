# Station Planner server on Oracle Cloud

The app saves every site, plan, image and setting to this server, so plans are the same on every device.
The server is one small Node.js program with an SQLite database, behind Caddy for HTTPS.

> **No login yet.** Anyone who knows the server address can open, change or delete plans. Keep the address to yourself until authentication is added.

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
| GET | `/api/health` | `{ok, app, counts}` |
| GET | `/api/{store}` | every record (`?siteId=` filters plans by site) |
| GET | `/api/{store}/{id}` | one record, or 404 |
| PUT | `/api/{store}/{id}` | create or replace (body `id` must match) |
| DELETE | `/api/{store}/{id}` | remove |

Settings live in `/etc/systemd/system/floorplan.service`. `ALLOWED_ORIGINS` limits which web addresses may use the server (for example `https://impulsenz.github.io`), and is `*` (any) for now.

When login is added, it goes in front of these routes in `server.mjs`, and the app's `Store` object sends the token with each request.
