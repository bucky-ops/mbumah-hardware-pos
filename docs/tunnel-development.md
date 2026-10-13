# Tunnel development (Daraja sandbox callbacks)

Safaricom's Daraja platform delivers STK Push results to a **public HTTPS** callback URL. When you develop or demo on a laptop, a LAN server or an offline install, Safaricom cannot reach `localhost` or `mbumah.test`. A tunnel gives your machine a public HTTPS address without deploying anything.

This guide covers ngrok, Cloudflare Tunnel and Tailscale Funnel for exactly that purpose. For offline-only testing skip the tunnel and use the mock (`MPESA_ENVIRONMENT=mock`, see [Local offline setup](local-offline-setup.md)).

Scope: everything here is development and testing. The production setup for self-hosted public subdomains (a named Cloudflare Tunnel with wildcard DNS, or a Caddy reverse proxy, plus the `TRUST_X_FORWARDED_HOST` forwarded-host trust flag) is documented separately in [Online hosting](online-hosting.md).

## Which tunnel to pick

| Tunnel | Wildcard hostnames | Notes |
|--------|--------------------|-------|
| ngrok | Paid plans (reserved domain + wildcard) | Quickest to start; free plan gives one random HTTPS URL (path mode) |
| Cloudflare Tunnel | Yes (`--url`, or a wildcard DNS route on your own hostname) | Free; stable URLs; good for long-running demos |
| Tailscale Funnel | Single public hostname per node | Great for developer machines already on Tailscale; one origin -> path mode |

## Wildcard vs path mode inside tunnels

- **Wildcard tunnel** (ngrok reserved wildcard, Cloudflare route on a domain you control): set `NEXT_PUBLIC_ROOT_DOMAIN` to the tunnel's domain and every branch subdomain resolves. Branch workspaces behave exactly like production.
- **Single-origin tunnel** (ngrok free, Tailscale Funnel): leave `NEXT_PUBLIC_ROOT_DOMAIN` unset (or set `NEXT_PUBLIC_STORE_WORKSPACE_MODE=path`). Workspaces use path mode: `https://<tunnel-host>/stores/juja-main/dashboard`. The raw tunnel host is accepted by the built-in host allowlist only for `*.vercel.app` and localhost - for other tunnel hosts add them to `ALLOWED_HOSTS`, for example:

  ```env
  ALLOWED_HOSTS=localhost,127.0.0.1,*.localhost,example.ngrok-free.app,mbumah.example.com,*.mbumah.example.com
  ```

  `ALLOWED_HOSTS` supports exact names and `*.` suffix wildcards; unknown hosts are rejected with 403.

  If a tunnel or proxy hop rewrites the `Host` header so the app no longer sees the client-visible hostname, set `TRUST_X_FORWARDED_HOST=true` so the workspace pipeline reads the `x-forwarded-host` header instead (first value wins). Only enable it behind a proxy or tunnel that overwrites the header - never on a directly exposed server (any client could spoof it). Default is false; the plain `Host` header is used otherwise.

## Point MPESA_CALLBACK_URL at the tunnel root

One environment variable does it all:

```env
MPESA_ENVIRONMENT=sandbox
MPESA_CALLBACK_URL=https://example.ngrok-free.app/api/payments/mpesa/callback
```

Rules:

- Always the **root** callback path - there is exactly one callback endpoint for the whole organization (`/api/payments/mpesa/callback`, a public, CSRF-exempt, rate-limited webhook).
- **No per-branch callback URLs**: the callback resolves the store from the transaction. Daraja returns the `CheckoutRequestID` created by the STK Push; the handler looks up the pending `MpesaTransaction` row (which already carries the sale's `storeId`) and applies the result there. Adding a branch never touches the Daraja portal.
- Register the same URL in the Daraja portal (or let the STK push's `CallBackURL` parameter carry it, which is what `MPESA_CALLBACK_URL` feeds).

## One root callback resolves the store from the transaction

The flow for any branch:

1. A cashier on `juja-main.mbumah.test` (or `/stores/juja-main/...`) checks out with M-Pesa.
2. The STK Push creates a `MpesaTransaction` row for that store, `status PENDING`, with the sale's `CheckoutRequestID`.
3. Safaricom POSTs the result to the single callback URL - regardless of which branch initiated it.
4. The handler matches the row by `CheckoutRequestID`, applies the atomic PENDING claim, settles the sale for the right store, and writes the receipt. Duplicate callbacks are idempotent (the unique `(storeId, mpesaReceiptNumber)` constraint makes a repeated receipt a no-op), and amount mismatches route the transaction to reconciliation instead of settling.

## Idempotency notes

- **Retried callbacks are safe**: the atomic claim on `PENDING` + `callbackReceived=false` rows and the receipt unique constraint mean Safaricom can retry freely; replays return 200 without re-applying anything.
- **Tunnel restarts are safe**: a callback that arrives while the tunnel is down is lost to Safaricom, but the pending transaction can be settled by the STK query polling path (the app polls Daraja's query API on a backoff schedule for queued requests), or re-initiated - the client-generated idempotency key on the sale prevents double-posting.
- **Rate limiting**: the callback endpoint applies its own webhook rate limit per source IP; when testing behind one tunnel IP with many pushes, expect `429` with `Retry-After` if you hammer it.
- **Mock vs sandbox**: flat mock-shaped callback bodies are only accepted when `MOCK_CALLBACKS_ENABLED=true`; real Daraja sandbox payloads use the nested format and need no extra flag.

## Quick recipe (ngrok) - DEV/TESTING ONLY

ngrok is for development and testing only: free tunnels get a random URL on every restart and have no wildcard hostnames, so branch subdomains cannot resolve. Production must use Cloudflare Tunnel (named tunnel, wildcard DNS route) or a proper reverse proxy - see [Online hosting](online-hosting.md).

```bash
# 1. Start the app (dev or production build) on port 3000
npm run dev

# 2. Expose it
ngrok http 3000
#    -> https://example.ngrok-free.app

# 3. .env
#    MPESA_ENVIRONMENT=sandbox
#    MPESA_CALLBACK_URL=https://example.ngrok-free.app/api/payments/mpesa/callback
#    ALLOWED_HOSTS=localhost,127.0.0.1,*.localhost,example.ngrok-free.app

# 4. Restart the app, run an STK push from any branch workspace,
#    and watch the callback settle the right store's transaction.
```

## Related documents

- [Online hosting](online-hosting.md) - production tunnels and reverse proxies for public subdomains
- [Local offline setup](local-offline-setup.md) - mock M-Pesa and offline domains
- [Vercel deployment](vercel-deployment.md) - the production callback setup (no tunnel needed)
- [Subdomain workspaces](subdomain-workspaces.md) - host allowlist and workspace routing
