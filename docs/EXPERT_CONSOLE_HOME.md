# Expert Console Home action

## What was added

The Expert Console (/console) header carries a Home button (v2.109.0):

- Label: Home
- Icon: Home (Lucide)
- Accessible name: Back to POS
- testid: console-home-pos

Clicking it returns the user to the POS workspace.

## Canonical POS destination

The destination is the root SPA ("/") with the POS tab active. One helper
owns the behavior: goHomeToPos in src/components/console/unified-console.tsx.
It sets the active tab to pos through the same zustand store the SPA itself
uses, then assigns the internal path "/".

The helper takes no argument. No query parameter, header, or client input
can change where it goes, so the Home action cannot become an open redirect.
If the store is not hydrated (or private mode blocks it), navigation still
proceeds and the SPA lands on its default tab rather than a wrong one.

## Placement and behavior details

- The button is the FIRST item in the header actions row, so it can never
  overlap the health gauge, store selector, chat, notifications, or user chip.
- It is a standard button element: keyboard reachable, visible focus ring,
  ghost variant so it does not compete with the console's primary actions.
- It renders only when the header is asked for it (showHome). The Expert
  Console passes showHome; the Organization Console keeps its own header
  without the action.
- Navigation happens in the same tab. No new window is opened.
- The button does not bypass authentication or server-side store validation:
  navigating to "/" is the same SPA the user was already in, and every data
  fetch inside it re-validates the session as usual.

## Unified shell

Both console routes render through UnifiedConsoleShell
(src/components/console/unified-console.tsx):

- mode="expert" for /console
- mode="organization" for /org/dashboard

The shell unifies the mode contract (a data-console-mode attribute and a
testid on the root), the skip-to-content landmark, and the main landmark.
It deliberately does not flatten the two headers' visual designs, and it
does not move either console's sections. Every existing capability stays
exactly where it is (see docs/CONSOLE_MERGE_PARITY_MATRIX.md).

## Keyboard and accessibility

- The button is focusable in DOM order (first action in the header).
- The accessible name is "Back to POS", which survives the visible label.
- Focus uses the shared Button focus-visible ring.
