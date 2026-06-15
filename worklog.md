---
Task ID: 1
Agent: Main Agent
Task: Add gift card edit, delete, and update options with enhanced UI

Work Log:
- Explored full gift card codebase: API routes, frontend component, types, API client
- Enhanced backend DELETE endpoint to support hard delete via ?hardDelete=true query param
- Added initialBalance to updatable fields in PUT endpoint (with validation >= currentBalance)
- Added support for clearing expiry date (null value)
- Rewrote gift-cards-tab.tsx with major enhancements:
  - Added DropdownMenu on each gift card with all actions (Edit, Redeem, Adjust Balance, Toggle Visibility, Cancel, Delete)
  - Created dedicated Edit Dialog separate from detail view
  - Added hard delete confirmation dialog for SUPER_ADMIN
  - Added quick action buttons at bottom of each card
  - Improved card layout with action buttons
- Fixed DialogContent accessibility warnings:
  - messaging-tab.tsx: Added DialogDescription to 3 dialogs
  - page.tsx: Replaced aria-describedby={undefined} with proper sr-only DialogHeader
- Updated API client giftCardsApi.delete() to accept hardDelete parameter
- Updated UpdateGiftCardPayload type with initialBalance and nullable expiryDate
- Lint passes clean
- Committed and pushed to GitHub (main branch)

Stage Summary:
- Gift cards now have full CRUD: Create, Read, Update (Edit dialog), Delete (soft cancel + hard delete)
- Each card has dropdown menu + quick action buttons for all operations
- Edit dialog is now a separate, focused dialog (not buried in detail view)
- Hard delete available only for SUPER_ADMIN on non-active cards
- All Dialog accessibility warnings fixed across the app
- Pushed to GitHub: commit e267239
