# Local offline setup

This guide turns a single laptop or desktop into a complete multi-branch Mbumah Hardware install that works without internet: branch subdomains on a private domain, HTTP or local HTTPS, and mock M-Pesa so checkout flows can be exercised end to end. Path mode (plain `http://localhost:3000`) also works with zero setup - the hostname work below only adds subdomain mode.

## Environment variables for offline mode

Set these in `.env`. A ready-made template lives in `.env.local-offline.example` (copy it to `.env` and fill the secrets); the `SUBDOMAIN WORKSPACES` section of `.env.example` documents every option:

```env
APP_MODE=local-offline
NEXT_PUBLIC_ROOT_DOMAIN=mbumah.test
NEXT_PUBLIC_USE_SUBDOMAINS=true
NEXTAUTH_COOKIE_SECURE=false
NEXTAUTH_COOKIE_DOMAIN=.mbumah.test
MPESA_ENVIRONMENT=mock
MPESA_CALLBACK_URL=http://mbumah.test:3000/api/payments/mpesa/callback
```

Notes:

- `APP_MODE=local-offline` is an informational label for the deployment itself; the runtime behaviour is driven by the workspace and cookie variables above it.
- `NEXT_PUBLIC_ROOT_DOMAIN=mbumah.test` is the conventional offline domain; the local tooling defaults to it (`scripts/domains/stores.config.json`).
- `NEXTAUTH_COOKIE_SECURE=false` because the local origin is plain HTTP. The shared cookie domain (leading dot) gives single sign-on across `mbumah.test` and every branch subdomain.
- `MPESA_ENVIRONMENT=mock` is required offline: real Daraja sandbox callbacks need a public HTTPS URL, and an offline machine cannot receive one (see [Mock M-Pesa](#mock-mpesa) and [Tunnel development](tunnel-development.md)).

## Method 1: hosts file (simplest)

Generate the exact block to paste - the script only prints, it never edits your system file:

```bash
npm run domains:print
```

Prefer to have it written for you? The writer script takes a timestamped backup of the hosts file, replaces only its own clearly marked managed block, and verifies the write (re-run elevated when it says so):

```bash
sudo npm run domains:write-hosts       # macOS / Linux
# Windows: Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile -Command npm run domains:write-hosts"
npm run domains:write-hosts -- --remove   # strip the managed block again
```

Output (for the five seeded branches):

```text
# MBUMAH HARDWARE POS - branch workspace hosts entries (v2.16.0)
127.0.0.1	mbumah.test
127.0.0.1	juja-main.mbumah.test
127.0.0.1	thika.mbumah.test
127.0.0.1	ruiru.mbumah.test
127.0.0.1	nairobi-cbd.mbumah.test
127.0.0.1	nakuru.mbumah.test
```

Useful flags: `--ip 192.168.1.20` (LAN mode - point every hostname at the shop server), `--domain mbumah.lan` (custom root domain), `--ipv6` (add `::1` entries).

### Apply the entries per OS

**macOS**

```bash
sudo nano /etc/hosts      # paste the block, save
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

**Linux**

```bash
sudo nano /etc/hosts      # paste the block, save
```

(Name-service caching usually picks the change up immediately; if not, restart `nscd`/`systemd-resolved`.)

**Windows**

1. Open Notepad as Administrator.
2. Open `C:\Windows\System32\drivers\etc\hosts`.
3. Paste the block and save.

Then verify:

```bash
npm run domains:verify
```

Root console: `http://mbumah.test:3000` - Branch workspace: `http://juja-main.mbumah.test:3000` - Path fallback: `http://127.0.0.1:3000/stores/juja-main/dashboard`.

## Method 2: dnsmasq (whole network, no per-device edits)

On the server (or a Raspberry Pi already on the network) install dnsmasq and answer the whole domain with one line:

```ini
# /etc/dnsmasq.conf
address=/mbumah.test/192.168.1.20
```

```bash
sudo systemctl restart dnsmasq
```

Every device whose DNS points at that machine resolves `mbumah.test` and all `*.mbumah.test` subdomains to the server - new branches need no client changes. Point device DNS at the dnsmasq host (router DHCP settings, Pi-hole, or manual network settings). A Pi-hole instance accepts the same `address=/mbumah.test/IP` record under Local DNS records.

## nip.io / sslip.io: online convenience only

Services such as `nip.io` and `sslip.io` map hostnames that embed an IP (for example `127.0.0.1.nip.io` or `juja-main.192.168.1.20.sslip.io`) to that IP with zero configuration. They are handy when the device has internet DNS and you want branch-style hostnames without touching any DNS config.

They are **not** an offline method: resolution requires public DNS, so the moment the shop loses connectivity the hostnames stop resolving. For true offline use, use the hosts file or dnsmasq.

## Local HTTPS with mkcert or Caddy

The local install runs on plain HTTP by default. For HTTPS (needed if you want to exercise the secure-cookie path or test service-worker behaviour on a "real" origin):

**Option A - Caddy (recommended, one file)**

```text
mbumah.test, *.mbumah.test {
    reverse_proxy 127.0.0.1:3000
    tls internal
}
```

Run `caddy trust` once (or approve the prompt) so the operating system trusts Caddy's local certificate authority, then start Caddy. Caddy terminates TLS on 443 and proxies to the Next.js server on 3000. Keep `NEXTAUTH_COOKIE_SECURE=false` unless the browser actually sees `https://` URLs.

**Option B - mkcert in front of Next.js**

```bash
mkcert -install
mkcert mbumah.test "*.mbumah.test" localhost
# serve the Next.js production server over TLS with a small proxy, or run
# next dev with the experimental HTTPS flag using the generated certificates
```

Because the wildcard certificate covers `*.mbumah.test`, every branch subdomain works without extra certificates.

## Mock M-Pesa

Offline installs cannot call Safaricom, so checkout runs against the mock Daraja API:

- `MPESA_ENVIRONMENT=mock` - the payment layer treats M-Pesa as simulated. The STK push falls back to the mock server (`http://localhost:3001/api/mpesa/stkpush`) whenever Daraja credentials are absent, so a cashier is never blocked at the till.
- `docker/mpesa-mock/server.js` - a small Express service that simulates Daraja OAuth, STK Push (`/mpesa/stkpush/v1/processrequest`), the STK query endpoint and C2B registration. It fires the callback after about 3 seconds. The dev compose file (`docker-compose.yml`) runs it as the `mpesa-mock` service on port 3001 with `CALLBACK_URL` pointing back at the app.
- Point `MPESA_CALLBACK_URL` at the **root** callback: `http://mbumah.test:3000/api/payments/mpesa/callback`. One callback endpoint serves every branch - the callback resolves the store from the transaction record (by `CheckoutRequestID`), so no per-branch callback URL is needed.
- The callback route only accepts flat mock-shaped bodies when `MOCK_CALLBACKS_ENABLED=true`; real Daraja payloads use the standard nested shape.

**Why a tunnel is needed for real sandbox tests**: Safaricom's Daraja platform must reach your callback over public HTTPS. An offline `localhost` or `mbumah.test` address is unreachable from Safaricom. To test against the real Daraja sandbox, run the app behind ngrok, Cloudflare Tunnel or Tailscale Funnel - see [Tunnel development](tunnel-development.md). In production on Vercel or a public server, set `MPESA_CALLBACK_URL` to the public root callback and register it in the Daraja portal (see [Vercel deployment](vercel-deployment.md) for the managed setup and [Online hosting](online-hosting.md) for self-hosted public domains).

## The 30-minute idle timeout

The app locks the session after 30 minutes of inactivity (`src/hooks/use-idle-timeout.ts`). When it fires, the user sees the same session-expired flow as a 401 and must sign in again - any in-progress sale survives because carts persist in IndexedDB. This protects the till when a cashier steps away, which matters even more on a shared shop machine in offline mode where no cloud session policy exists.

## Quick reference

| Task | Command |
|------|---------|
| Print hosts entries | `npm run domains:print` |
| Verify subdomain workspaces against a running app | `npm run domains:verify` |
| Backfill store slugs/subdomains in the database | `npm run db:backfill-slugs` |
| Start the dev server | `npm run dev` |
