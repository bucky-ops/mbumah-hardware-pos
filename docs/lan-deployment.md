# LAN deployment

Run the POS on one server inside the shop network and let every device (tills, tablets, the manager's laptop) open any branch workspace over the LAN - with or without internet.

## Topology

One machine hosts the app (Docker Compose production stack, a nodocker install, or plain `npm start`) and the database. Every other device only needs a browser.

Example: the shop server is `192.168.1.20` and the app listens on port 3000.

```text
192.168.1.20   server: Next.js app (:3000), database, optional nginx/Caddy
192.168.1.31   till 1 (browser)
192.168.1.32   till 2 (browser)
192.168.1.33   manager laptop (browser)
```

## DNS: one wildcard for the whole network

Give every device a way to resolve `mbumah.test` and all `*.mbumah.test` hostnames to the server. Pick one:

- **dnsmasq on the server** (recommended): `address=/mbumah.test/192.168.1.20`, then point device DNS at `192.168.1.20` (manually or via the router's DHCP settings).
- **Pi-hole / router DNS**: the same `address=` record in Pi-hole (Local DNS) or a router that supports DNS wildcards / local records.
- **Per-device hosts fallback**: when you cannot change DNS settings, run `npm run domains:print -- --ip 192.168.1.20` on the server and paste the generated block into each device's hosts file (`/etc/hosts`, or `C:\Windows\System32\drivers\etc\hosts` on Windows as Administrator).

All three approaches keep working with zero internet: the hosts file never changes, and dnsmasq/Pi-hole answer locally. New branches are covered automatically by the wildcard - no client edits.

## Environment for LAN mode

A ready-made template lives in `.env.lan.example` (copy to `.env` on the server and fill the secrets). The essential values:

```env
NEXT_PUBLIC_ROOT_DOMAIN=mbumah.test
NEXT_PUBLIC_USE_SUBDOMAINS=true
NEXTAUTH_COOKIE_DOMAIN=.mbumah.test
NEXTAUTH_COOKIE_SECURE=false      # plain HTTP on the LAN
MPESA_ENVIRONMENT=mock            # no public callback without a tunnel
MPESA_CALLBACK_URL=http://mbumah.test:3000/api/payments/mpesa/callback
```

Raw IP addresses are always accepted by the host allowlist, so `http://192.168.1.20:3000` works for the root app even before DNS is set up.

## Windows Firewall (server reachable from other devices)

Windows Defender Firewall blocks inbound connections on private/public networks by default, so a laptop server answers `localhost` but other tills get timeouts. Open the app port once, as Administrator:

```powershell
# Inbound rule for the POS port (repeat with your actual port if not 3000)
New-NetFirewallRule -DisplayName "Mbumah POS 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private,Domain

# Verify from ANOTHER device (not the server itself):
#   Test-NetConnection 192.168.1.20 -Port 3000
```

Notes:
- Keep `-Profile Private,Domain` (mark the shop Wi-Fi network as Private first; Public blocks discovery).
- The no-Docker installer already starts the server bound to `0.0.0.0`; the firewall rule is what makes it reachable from other devices.
- Docker Desktop users: publish the port with `-p 3000:3000` and Docker installs its own firewall rules; the manual rule above is still the fallback when composes are run under WSL.

## Path mode fallback via the LAN IP

Any device can also reach a branch through the server's IP with no DNS at all - workspaces are addressed by path:

```text
http://192.168.1.20:3000/stores/juja-main/dashboard
http://192.168.1.20:3000/stores/thika/dashboard
```

This is the built-in behaviour for raw-IP hosts (`resolveWorkspaceHostMode` returns `organization` for them, so links render as `/stores/{slug}/...`). It is the quickest way to test a fresh install, and the permanent fallback when a device's DNS is misconfigured. Subdomain URLs (`http://juja-main.mbumah.test:3000`) are the nicer experience once DNS is in place: each branch gets its own browser origin, its own cart storage and the branch badge in the address bar.

## Multiple branch tabs

Branch workspaces are plain URLs, so the manager can keep several branches open side by side - the org console on `http://mbumah.test:3000/org/dashboard`, Juja Main and Thika in neighbouring tabs. Each tab pins its own store and cart; per-store cart snapshots in IndexedDB keep trolleys separate (see [Multi-store workspaces](multi-store-workspaces.md)).

## Shared database, shared ledger

All devices and branches talk to the one database on the server: stock, customers, debt and reports are live across tills. Tenant scoping and role rules are enforced server-side on every request, exactly as in production (see [RBAC](rbac.md)).

## Mock M-Pesa

On a LAN without internet, keep `MPESA_ENVIRONMENT=mock`. STK pushes run against the mock Daraja server (`docker/mpesa-mock`, port 3001 in the dev compose stack) and the callback returns to the root callback URL after a few seconds. Real Daraja sandbox callbacks need a public HTTPS endpoint - use a tunnel for that ([Tunnel development](tunnel-development.md)); the permanent online setup on your own domain is covered in [Online hosting](online-hosting.md).

## Verify

With the app running on the server:

```bash
npm run domains:verify -- --base http://192.168.1.20:3000 --root mbumah.test
```

The script prints a PASS/FAIL table covering the root page, the branch subdomain rewrite (with and without port), unknown-subdomain behaviour, host header rejection, reserved subdomains and API health through a branch host. Then open `http://juja-main.mbumah.test:3000/dashboard` from a till and sign in.
