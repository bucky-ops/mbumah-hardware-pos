# Online hosting (tunnels and public subdomains)

Serve the whole organization from your own public domain while self-hosting the app: `app.mbumah.co.ke` for the organization console and `juja-main.mbumah.co.ke`, `thika.mbumah.co.ke`, ... for every branch workspace. This is the self-hosted alternative to the managed Vercel deployment ([Vercel deployment](vercel-deployment.md)); for offline or LAN-only setups see [Local offline setup](local-offline-setup.md) and [LAN deployment](lan-deployment.md).

Two front doors are documented here:

| Front door | TLS certificates | Best for |
|------------|------------------|----------|
| Cloudflare Tunnel | Issued by Cloudflare at the edge | No open inbound ports, dynamic IPs, quick setup |
| Caddy reverse proxy | Automatic HTTPS from Let's Encrypt (DNS-01 for the wildcard) | Servers that already run a reverse proxy or want no Cloudflare dependency |

Both terminate public HTTPS and forward to the app on `http://localhost:3000`. ngrok is documented for development and testing only (see below).

## 1. Environment

Copy the online template to `.env` on the server and fill in the secrets:

```bash
cp .env.online.example .env
```

The template pre-wires the subdomain workspace variables for a `mbumah.co.ke` deployment:

- `NEXT_PUBLIC_ROOT_DOMAIN=mbumah.co.ke` with `NEXT_PUBLIC_USE_SUBDOMAINS=true` and `NEXT_PUBLIC_STORE_WORKSPACE_MODE=auto`: a host matching `{store}.{root domain}` serves that branch; raw localhost and raw LAN IP requests always fall back to path mode (`/stores/{slug}/...`) automatically.
- `NEXTAUTH_URL=https://app.mbumah.co.ke` (the canonical console URL) and the shared cookie block (`NEXTAUTH_COOKIE_DOMAIN=.mbumah.co.ke`, `NEXTAUTH_COOKIE_SECURE=true`, `NEXTAUTH_COOKIE_SAME_SITE=lax`) for single sign-on across the console and every branch subdomain.
- `ALLOWED_HOSTS=app.mbumah.co.ke,*.mbumah.co.ke,mbumah.co.ke,localhost,127.0.0.1`: the host allowlist. Unknown hosts are rejected with 403 (host header attack protection).
- `DATABASE_URL` / `DIRECT_URL`: production PostgreSQL (commented placeholders in the template). Online mode is a production deployment; do not run it on SQLite.
- `MPESA_CALLBACK_URL=https://app.mbumah.co.ke/api/payments/mpesa/callback` (commented placeholder): one root callback serves every branch, because the callback resolves the store from the transaction (see [Tunnel development](tunnel-development.md) for how the callback stays branch-agnostic).

## 2. x-forwarded-host trust (TRUST_X_FORWARDED_HOST)

The workspace pipeline resolves the branch from the request host. Behind a front door there are two headers involved:

- `Host`: what the front door forwards to the app. Cloudflare Tunnel and Caddy both preserve the original `Host` by default, so subdomain resolution works out of the box.
- `x-forwarded-host`: set (overwritten) by the proxy or tunnel with the client-visible hostname. When the path to the app has more than one hop, or a hop rewrites `Host`, this is the header that still carries the real branch hostname.

`TRUST_X_FORWARDED_HOST=true` (set in `.env.online.example`) tells the app to prefer the first `x-forwarded-host` value; with the flag off (the default in `.env.example` and every other template) the header is ignored and only `Host` is read, exactly as in releases before v2.17.7.

Security contract:

- Enable it ONLY behind a proxy or tunnel that OVERWRITES `x-forwarded-host` on every request (Cloudflare Tunnel, Caddy, nginx with an explicit `proxy_set_header X-Forwarded-Host $host;`).
- Never enable it on a directly exposed server. On a direct connection any client can set the header itself and impersonate another workspace origin.
- The app still validates the resolved host against `ALLOWED_HOSTS`, so a spoofed or unknown host is rejected with 403 even with the flag on. Defense in depth, not a substitute for the contract above.

## 3. Cloudflare Tunnel (production)

A named tunnel gives the server a stable public identity without opening any inbound port. Cloudflare issues certificates at the edge, so no TLS setup is needed on the server.

```bash
# 1. Authenticate and create the tunnel
cloudflared tunnel login
cloudflared tunnel create mbumah-pos

# 2. Route DNS: the console host and the branch wildcard.
#    Each command creates a CNAME to <TUNNEL-ID>.cfargotunnel.com.
cloudflared tunnel route dns mbumah-pos app.mbumah.co.ke
cloudflared tunnel route dns mbumah-pos "*.mbumah.co.ke"

# 3. Run the tunnel (install as a service for always-on hosting)
cloudflared tunnel run mbumah-pos
# sudo cloudflared service install
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /etc/cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: app.mbumah.co.ke
    service: http://localhost:3000
  - hostname: "*.mbumah.co.ke"
    service: http://localhost:3000
  - service: http_status:404
```

Notes:

- cloudflared forwards the original request `Host` header to `http://localhost:3000` (unless you explicitly set `originRequest.httpHostHeader`), so the Next.js proxy sees `app.mbumah.co.ke` or the real branch hostname and subdomain resolution works.
- `TRUST_X_FORWARDED_HOST=true` covers the cases where `Host` is rewritten along the way (a second proxy hop, or an explicit `httpHostHeader` override): the client-visible hostname still arrives in `x-forwarded-host`.
- Keep `ALLOWED_HOSTS` in sync with the hostnames you routed. Anything else is rejected with 403.
- The wildcard DNS route must exist before branch subdomains resolve; the Cloudflare dashboard (DNS tab) shows the two CNAME records created by `tunnel route dns`.

## 4. Caddy reverse proxy (production)

Caddy issues and renews certificates automatically. A wildcard certificate (`*.mbumah.co.ke`) requires the DNS-01 challenge, which needs a DNS provider plugin or API token - the example below uses the Cloudflare DNS provider (`xcaddy build --with github.com/caddy-dns/cloudflare` or a download that includes it):

```text
{
    admin off
}

app.mbumah.co.ke, *.mbumah.co.ke {
    reverse_proxy 127.0.0.1:3000
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
}
```

Security and behavior notes:

- Caddy preserves the original `Host` header by default (no `host` rewrite needed), and it sets `X-Forwarded-Host` with the client-visible hostname - so `TRUST_X_FORWARDED_HOST=true` is safe and useful here.
- `admin off` disables the Caddy admin API on `localhost:2019` (one less surface on a production box).
- Do not enable `debug` or verbose logging in the global block; the default logging is sufficient.
- Automatic HTTPS covers both site addresses; the DNS-01 challenge above is what makes the wildcard certificate possible (plain HTTP-01 cannot issue `*.mbumah.co.ke`).
- For a LAN-internal Caddy with locally-trusted certificates instead of public domains, see the `tls internal` variant in [Self-hosting](self-hosting.md).

## 5. ngrok (DEV/TESTING ONLY)

ngrok is for development and testing only: free tunnels get a random URL on every restart, and the free plan has no wildcard hostnames, so branch subdomains cannot resolve. Production must use Cloudflare Tunnel or a proper reverse proxy (Caddy, nginx) in front of the app.

```bash
# Dev/testing only: expose the local app for a Daraja sandbox test
ngrok http 3000
#    -> https://example.ngrok-free.app
```

With a single-origin tunnel, workspaces use path mode (`https://example.ngrok-free.app/stores/juja-main/dashboard`); add the tunnel host to `ALLOWED_HOSTS` and point `MPESA_CALLBACK_URL` at the tunnel root. The full recipe (including the sandbox callback wiring) is in [Tunnel development](tunnel-development.md). No `TRUST_X_FORWARDED_HOST` needed for this shape: the tunnel host arrives in the `Host` header itself.

## 6. Verify

With the tunnel or proxy running and `.env` in place:

```bash
# 1. Health through the console host
curl -s https://app.mbumah.co.ke/api/health

# 2. The PASS/FAIL matrix: root page, branch rewrite with and without port,
#    unknown subdomain, host header rejection, reserved subdomains, health
npm run domains:verify -- --base https://app.mbumah.co.ke --root mbumah.co.ke

# 3. Open a branch workspace and sign in once
#    https://juja-main.mbumah.co.ke/dashboard
#    (the shared cookie should carry the session into other branches)
```

## Related documents

- [Vercel deployment](vercel-deployment.md) - the fully managed production alternative (wildcard domains on Vercel)
- [Tunnel development](tunnel-development.md) - ngrok/Cloudflare/Tailscale tunnels for Daraja sandbox callbacks (dev and testing)
- [Subdomain workspaces](subdomain-workspaces.md) - the routing and security model behind the hostnames above
- [Self-hosting](self-hosting.md) - Docker Compose stack, nginx wiring, LAN Caddy variant, health endpoints
- [LAN deployment](lan-deployment.md) - offline LAN hosting without public domains
