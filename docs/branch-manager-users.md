# Branch manager users

Every branch of Mbumah Hardware has its own branch manager account. This document explains how the binding between an account and its branch works, which email signs in to which branch, and how the system prevents one branch's manager from touching another branch's data. For the workspace routing around it see [Branch workspaces](branch-workspaces.md); for the request-time enforcement see [Store context resolution](store-context-resolution.md).

## The binding lives in the database

A branch manager's branch comes from the `User.storeId` relation in the database (plus an ACTIVE `StoreMembership` row for the multi-store workspace layer). It is decided at sign-in from the signed-in user's database record, never from the email text, a cookie, a header, a query parameter, or any client-supplied storeId. Two accounts on the same email domain can belong to two different branches; nothing about the address itself selects the branch.

Rules enforced server-side:

- `BRANCH_MANAGER` and `CASHIER` accounts must have a `storeId`. The user-creation API rejects the unassigned shape at two layers (the Zod schema and the route handler), and the assigned store must be an ACTIVE branch in the caller's organization.
- An account of these roles without an assignment can never reach the organization console. Sign-in sends it to `/account/pending-branch`, a calm page that asks the account to contact the store owner or system administrator.
- A branch manager can only read and write their own branch. Cross-branch attempts by URL, API path, query, header, or body return 403 or a safe 404 and are written to the SecurityEvent audit feed.
- Only SUPER_ADMIN can create users; `SUPER_ADMIN` and `ACCOUNTANT` roles can only be minted by a SUPER_ADMIN; every creation writes a tamper-evident, hash-chained AuditLog entry alongside the SystemLog rows.

## Seeded branch managers

The seed creates exactly one branch manager per store, idempotently (upsert by email; re-running the seed never duplicates users and never overwrites existing names, phone numbers or passwords). Deterministic emails follow the existing `{town}.manager@` convention:

| Branch | Email | Slug |
|--------|-------|------|
| Juja Main | `juja.manager@mbumahhardware.co.ke` | `juja-main` |
| Thika | `thika.manager@mbumahhardware.co.ke` | `thika` |
| Ruiru | `ruiru.manager@mbumahhardware.co.ke` | `ruiru` |
| Nairobi CBD | `nairobi.manager@mbumahhardware.co.ke` | `nairobi-cbd` |
| Nakuru | `nakuru.manager@mbumahhardware.co.ke` | `nakuru` |

Demo passwords are for LOCAL/OFFLINE use only and are never shipped in plaintext: every seeded account stores a bcrypt hash (cost 12). Never reuse demo credentials on an internet-facing deployment.

Databases initialized before a store had its manager (for example the Juja Main manager on older laptops) are healed automatically: the seed's ensure-pass runs on every seed invocation, even on already-initialized databases, and creates any missing manager and membership without touching other data. The same repair is available manually:

```bash
node scripts/repair-branch-manager-schema.mjs            # backup + additive repair
node scripts/repair-branch-manager-schema.mjs --check    # report only
bun run verify:branch-manager-users                      # read-only verification
```

The repair script uses raw SQL only, backs the database up first, backfills a missing `storeId` only when the email's `{town}` part maps deterministically to a store slug, stops instead of forcing the unique email index when duplicates exist, and restores the backup on any failure.

## Canonical demo email domain

The seed is the source of truth for local demo login, and every demo address in the seed uses `mbumahhardware.co.ke`. README and docs match this decision. The workspace root domain (`mbumah.co.ke`, used for subdomain workspaces such as `juja-main.mbumah.co.ke`) is a separate hosting concern and is NOT the login domain. A legacy `manager@mbumahhardware.co.ke` account does not exist in the seed or in the shipped databases; if one exists on a private deployment it keeps working, and the seed's conflict rule leaves an address collision untouched and reports it instead of repurposing the account.

## Login redirect behavior

After sign-in:

- SUPER_ADMIN, STORE_OWNER and ACCOUNTANT land on the organization console.
- WAREHOUSE_MANAGER goes through the branch selector (`/branches/select`).
- BRANCH_MANAGER and CASHIER land in their own branch workspace: the branch is their assigned store from the database, the URL is the subdomain workspace when the current host is subdomain-capable, and the path workspace (`/stores/{slug}/dashboard`) on localhost, raw IPs, or when subdomains are disabled. An account with no branch assignment goes to `/account/pending-branch`; an account whose store has no slug configured stays on the pinned root app (the workspace gateway reports the missing-slug configuration error if they open a branch URL).
- Users who sign in while already inside a workspace context (a branch subdomain, a path workspace, the org console, the branch selector, or the pending-branch page) stay where they are.

## Related

- [Branch workspaces](branch-workspaces.md) - hosting modes and the "Open branch workspace" action
- [Store context resolution](store-context-resolution.md) - request-time authorization and reason codes
- [Multi-store workspaces](multi-store-workspaces.md) - org console and branch selector
- [Troubleshooting and FAQ](troubleshooting-and-faq.md) - sign-in and workspace entries
