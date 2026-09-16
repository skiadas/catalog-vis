# Deploying major-vis on AWS Lightsail (with SSO login)

Operator runbook for the hosted deployment: the major-vis container behind
Caddy on a small Lightsail instance, with sign-in delegated to an external
OpenID Connect issuer. It assumes the SSO is already running (the reference
instance is `https://sso.harisskiadas.com`, built from
[`otc-oidc`](https://github.com/skiadas/otc-oidc); see that repo for its own
runbook).

## What you end up with

- `https://catalog.harisskiadas.com` — the launcher, the built apps, the public
  catalog API, and the backend API, served by one container.
- Sign-in leaves for the issuer: the app redirects the browser to
  `https://sso.harisskiadas.com`, which emails a one-time code, and returns the
  browser to `/api/auth/callback`; the app server exchanges the code, validates
  the ID token, provisions the user by email, and sets its own `mjv_sid`
  cookie. Sessions last 30 days; the cookie is `HttpOnly` + `Secure` +
  `SameSite=Lax`.
- Every signed-in user sees every schedule; only the owner edits one directly
  (others propose changes that the owner approves). Anonymous visitors browse
  the catalog and can "work offline" locally, but see no server schedules.

## Costs (checked September 2026)

| Plan (Linux, public IPv4) | RAM    | vCPU | SSD    | Transfer | USD/mo |
| ------------------------- | ------ | ---- | ------ | -------- | ------ |
| Nano-0.5GB                | 0.5 GB | 2    | 20 GB  | 1 TB     | $5     |
| Micro-1GB                 | 1 GB   | 2    | 40 GB  | 2 TB     | $7     |
| Small-2GB                 | 2 GB   | 2    | 60 GB  | 3 TB     | $12    |
| Medium-4GB                | 4 GB   | 2    | 80 GB  | 4 TB     | $24    |

IPv6-only variants are cheaper ($3.50/$5/$10/$20) but complicate Let's Encrypt
and reachability — don't. The app container is capped at 512 MB and idles well
under it, so **1 GB ($7/mo) is enough for the app alone**; use 2 GB if you
later colocate the SSO or other services on the same box. Static IPs are free
while attached to a running instance. AWS currently offers a 90-day free trial
on the $5/$7/$12 plans.

## 1. Instance

1. Lightsail → Create instance → **Ubuntu 24.04 LTS**, **Micro-1GB**, attach a
   **static IP**.
2. Networking → firewall: SSH (restrict to your address), HTTP 80, HTTPS 443.
   Nothing else needs to be open.
3. DNS: an **A record** `catalog.harisskiadas.com` → the static IP.
4. Install Docker:

   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker "$USER"   # log out/in for the group to apply
   ```

## 2. Register the app as an OIDC client

On the **SSO host** (e.g. `/opt/otc-oidc/`):

1. Generate a client secret: `openssl rand -base64 32`
2. Add an entry to `clients.json`:

   ```json
   {
     "client_id": "major-vis",
     "client_secret": "<the generated secret>",
     "name": "Major Catalog Visualizer",
     "redirect_uris": ["https://catalog.harisskiadas.com/api/auth/callback"],
     "grant_types": ["authorization_code"],
     "response_types": ["code"],
     "token_endpoint_auth_method": "client_secret_post",
     "scope": "openid email"
   }
   ```

   The redirect URI must match the app's `OIDC_REDIRECT_URI` byte-for-byte
   (scheme, host, path — no wildcards). New client ids are picked up by the
   SSO's reconciler within about a minute, no restart; editing an existing
   entry still needs one. PKCE (S256) is required and enforced server-side.

3. Check the SSO's `ALLOWED_EMAIL_DOMAINS` includes the addresses you expect to
   log in.

## 3. Deploy the app

On the app instance:

```sh
sudo mkdir -p /opt/major-vis/deploy && cd /opt/major-vis
sudo curl -fsSLo compose.yaml      https://raw.githubusercontent.com/skiadas/catalog-vis/main/compose.yaml
sudo curl -fsSLo deploy/Caddyfile  https://raw.githubusercontent.com/skiadas/catalog-vis/main/deploy/Caddyfile
sudo curl -fsSLo deploy/update.sh  https://raw.githubusercontent.com/skiadas/catalog-vis/main/deploy/update.sh
sudo curl -fsSLo deploy/.env.example https://raw.githubusercontent.com/skiadas/catalog-vis/main/deploy/.env.example
sudo chmod +x deploy/update.sh
cp deploy/.env.example .env
# edit .env: the client secret, and uncomment COMPOSE_PROFILES=proxy + APP_DOMAIN
docker compose up -d
docker compose logs -f caddy   # watch certificate issuance, then Ctrl-C
```

`docker compose` reads `.env` automatically. The `proxy` profile starts Caddy
on 80/443; the app itself is bound to `127.0.0.1:8080` (set via `PUBLIC_PORT`)
and reached by Caddy over the compose network.

## 4. Verify

```sh
curl -s https://catalog.harisskiadas.com/api/config | grep -o '"provider":"[a-z]*"'
# -> "provider":"oidc"
curl -s -o /dev/null -w '%{http_code}\n' https://catalog.harisskiadas.com/api/schedules
# -> 401 (anonymous sees nothing)
```

In a browser: open the app → **Sign in with SSO** → email code → land back
signed in; create a schedule; a second account sees it in the shared list.
In DevTools, the `mjv_sid` cookie should show `Secure`, `HttpOnly`, `Lax`.

## 5. Updates

Cron pulls the latest GHCR image and recreates the stack only when the image
actually changed. The script also refreshes the repo-owned deploy files
(`compose.yaml` + `deploy/Caddyfile`) before pulling, so config changes ride
along with image updates; `.env` and the data volume are never touched:

```sh
# crontab -e, on the app instance
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * /opt/major-vis/deploy/update.sh >> /var/log/major-vis-update.log 2>&1
```

`docker compose up -d` re-reads `.env`, so the `COMPOSE_PROFILES` value keeps
Caddy running across updates. To apply a config-only change immediately
(without waiting for the next image), run `docker compose up -d` by hand.

## 6. Backups

The only stateful piece is the SQLite database in the `major-vis-data` volume:

```sh
docker run --rm -v major-vis-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/major-vis-db-$(date +%F).tgz -C /data .
```

On the SSO host, the irreplaceable files are its `clients.json` and audit log
(see the otc-oidc README).

## 7. Troubleshooting

The app redirects failed sign-ins back with `?auth_error=<code>`, which the
auth prompt translates into a message:

| Code              | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `invalid_state`   | Login link expired (10 min) or was replayed — start again.              |
| `sso_unavailable` | The app could not reach the issuer's discovery document.                |
| `sso_failed`      | Token exchange or ID-token validation failed (secret/redirect mismatch).|
| `sso_access_denied` | The user cancelled at the issuer.                                     |
| `email_missing`   | The issuer returned no `email` claim.                                   |

- **Certificate never issues**: DNS must resolve before Caddy starts, and ports
  80/443 must be open. `docker compose logs caddy` shows the ACME error.
- **`invalid_client` in the app logs**: the `OIDC_CLIENT_SECRET` in `.env` and
  the SSO's `clients.json` disagree (whitespace counts).
- **Session not sticking**: `COOKIE_SECURE=true` requires HTTPS; for plain-http
  local runs set it to `false`.
- **SSO restart**: in-memory SSO sessions are lost (users re-enter a code on
  their next sign-in); the app's own `mjv_sid` sessions survive in SQLite.
