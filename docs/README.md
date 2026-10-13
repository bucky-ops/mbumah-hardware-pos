# Documentation

Documentation for Mbumah Hardware POS. Start with the [README](../README.md) for a project overview and quick start.

## Guides

| Document | Contents |
|----------|----------|
| [Architecture](architecture.md) | System design, tech stack, proxy pipeline, workspaces layer, offline queue, realtime notifications |
| [Project structure](project-structure.md) | Repository layout and where to make common changes |
| [API reference](api-reference.md) | REST endpoints by module |
| [Database schema](database-schema.md) | Prisma models, relationships, key constraints |
| [Authentication and RBAC](authentication-and-rbac.md) | Roles, permission matrix, manager step-up authorization |
| [RBAC](rbac.md) | Role scopes, permission matrix layers, ORM tenancy, memberships, abuse lockout |
| [Multi-tenant architecture](multi-tenant-architecture.md) | Store isolation, tenant enforcement, store seeding |
| [Subdomain workspaces](subdomain-workspaces.md) | Master reference for v2.16.0 branch workspaces: modes, routing, authorization, security, adding stores |
| [Multi-store workspaces](multi-store-workspaces.md) | Organization console, branch selector, workspace UI, memberships, cart isolation |
| [Global chat](global-chat.md) | GLOBAL channel, store threads, origin badges, endpoints, polling, security |
| [Configuration](configuration.md) | Environment variables, M-Pesa Daraja, optional services |
| [Deployment](deployment.md) | Vercel, Docker Compose, self-hosting, SSL, backups, provider switching |
| [Vercel deployment](vercel-deployment.md) | Production domains, wildcard DNS, workspace env vars, build chain, release flow |
| [Self-hosting](self-hosting.md) | docker-compose.prod.yml, nginx subdomain wiring, Caddy, nodocker/laptop installs, health endpoints |
| [LAN deployment](lan-deployment.md) | One shop server on the local network: DNS wildcard, path fallback, shared DB, mock M-Pesa |
| [Local offline setup](local-offline-setup.md) | Offline localhost/LAN mode: hosts file, dnsmasq, local HTTPS, mock M-Pesa, idle timeout |
| [Tunnel development](tunnel-development.md) | ngrok/Cloudflare/Tailscale tunnels for Daraja sandbox callbacks |
| [Online hosting](online-hosting.md) | Self-hosted public subdomains: Cloudflare Tunnel config, Caddy reverse proxy, .env.online.example, forwarded-host trust |
| [Troubleshooting and FAQ](troubleshooting-and-faq.md) | M-Pesa callbacks, Vercel 500s, ghost shifts, common fixes |
| [Hosting readiness audit](hosting-readiness-audit.md) | External hosting spec and guide reviewed against the repo: phase status, corrections, gap register |
| [Offline mode](offline-mode.md) | Offline sales queue, idempotent replay, top-bar indicator, testing |
| [Release process](release-process.md) | Versioning, changelog, release automation |

## Operations

| Document | Audience |
|----------|----------|
| [Client setup and daily use](CLIENT_SETUP_GUIDE.md) | Shop staff: daily routine, backups, troubleshooting without technical knowledge |
| [Repository hygiene](../CONTRIBUTING.md) | Contributors: workflow, code style, commit convention |
| [Security policy](../SECURITY.md) | Reporting vulnerabilities, security controls |
| [Support](../SUPPORT.md) | Help channels and what to include in a bug report |
| [Code of conduct](../CODE_OF_CONDUCT.md) | Community standards |
| [Changelog](../CHANGELOG.md) | Release history |

## Archive

The [archive](archive/README.md) keeps historical audit, planning, and incident reports for reference. They describe past states of the codebase and are superseded by this documentation and the changelog.
