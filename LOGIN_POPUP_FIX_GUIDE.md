# Login Pop-up Fix — Stepwise Troubleshooting Guide (v2.5.2)

**Problem reported:** "Remove the Pops from Login (causing a loop, I cannot access
the login) — ensure they pop only when the product is selected, hovered on, or in
cart."

**Audience:** developers and tech-savvy staff. Simple English, short steps.

---

## Step 1 — Identify the source of the pop-ups (why they fired at login)

There were **four** pop-up sources that could fire on the login screen:

| # | Source | File | What it did at login |
|---|--------|------|----------------------|
| 1 | `toast.success('Welcome…')` after signing in | `src/components/login-screen.tsx` | A toast popped the moment you logged in. |
| 2 | `toast.error(message)` on wrong credentials | `src/components/login-screen.tsx` | Every failed try popped a toast. Retrying = more popping. |
| 3 | `toast.info(…)` on "Forgot password?" | `src/components/login-screen.tsx` | Help opened as a pop-up instead of in place. |
| 4 | **Global error toasts** (`Unexpected Error` / `Runtime Error`) | `src/lib/providers.tsx` | ANY unhandled JS/network error popped a toast — **even before login**. With retries this felt like pop-up spam over the form. |

Combined with the **v2.5.0 alert-popup host** that polled notifications before
login (each poll 401'd and, in the very old builds, reloaded the page — the
infinite loop), the login screen "kept flashing and popping" and users could
not reach the form.

## Step 2 — How the pop-ups were removed from login

1. **All three login-screen toasts deleted.** No `toast.*` calls remain in
   `login-screen.tsx` (verified by searching the file for `toast.`).
2. **Inline feedback instead of overlays** (UX best practice — feedback lives
   next to the field it belongs to):
   - Wrong credentials → an **inline red banner inside the card**
     (`role="alert"`, `aria-live="assertive"`, with a ✕ dismiss button).
     It never blocks typing and never floats above the page.
   - Successful login → **no pop at all**; the dashboard appearing IS the
     confirmation.
   - "Forgot password?" → an **inline collapsible panel** with the support
     phone number and e-mail (no toast).
3. **Global error toasts are now signed-in only.** `GlobalErrorHandler`
   checks `useAuthStore.getState().isAuthenticated` before popping. Before
   login, errors are logged to the console only — the screen stays silent.
4. **Alert pop-ups are authenticated-only** (kept from v2.5.1): the
   `AlertPopupHost` notification poll is disabled until the user is signed in
   (`enabled: isAuthenticated && !!currentStoreId`), and any leftover pop-ups
   are cleared on logout/expiry.

## Step 3 — Where pop-ups still appear (product interactions only)

Pop-ups remain a **Point-of-Sale feature**, tied to product activity:

- **Product selected / added to cart** → toast + cart feedback in the POS tab.
- **Product hover** → tooltip / hover cards in the POS grid and sidebar
  prefetch (`preloadTab` on `pointerenter`).
- **Stock & store events while signed in** → 45-second alert pop-ups
  (bottom-left stack, countdown bar, pause-on-hover, manual ✕ close).
- Recommendation chips in the cart ("frequently bought together") pop only
  when a cart exists.

Nothing in the login/auth flow raises pop-ups anymore.

## Step 4 — Testing methods (how to verify)

Manual checks (5 minutes):

1. **Login silence test** — open `/` in a private window. Watch for 60s:
   no toast, no pop-up, no reload may appear. Type credentials with the form
   fully visible.
2. **Inline error test** — submit a wrong password. An inline red banner must
   appear inside the card (not a toast). It disappears on the next submit.
3. **Forgot-password test** — click "Forgot password?" — a small panel opens
   under the field with 0795 191 909 (no pop-up).
4. **Successful login test** — sign in: the dashboard renders directly, no
   "Welcome" toast.
5. **Product pop test** — in POS: add an item to the cart → a toast appears;
   hover a product → tooltip; add a second item → recommendation chip.
6. **Signed-in alert test** — while signed in, a critical notification
   (e.g. out-of-stock) pops the 45-second alert card bottom-left.

Automated: `bun run lint`, type-check, and the existing test suite run on
every PR; the login screen renders in the smoke-tested `/` route.

## Notes for future developers

- Keep authentication surfaces **pop-free**: toasts belong to app features,
  not to forms that own their inline state.
- If you add a global poller, gate it on `isAuthenticated` **and** make sure
  a 401 can never reload the page (`mbt:session-expired` flips the SPA —
  see `src/lib/api.ts → handleSessionExpired`).
- Footer version: renders `package.json` via `src/lib/version.ts`
  (`APP_VERSION_LABEL`) — bump the version in ONE place only.
