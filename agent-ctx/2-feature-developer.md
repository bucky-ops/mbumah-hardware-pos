# Task 2 - Feature Developer: Low Stock Alert Panel & Notification Center

## Task Summary
Added two new features to the MBUMAH HARDWARE POS & ERP System:

### Feature 1: Low Stock Alert Panel
- **Component**: `LowStockAlertDialog` - A Dialog that opens when the "Low Stock" dashboard stat card is clicked
- Shows all out-of-stock products (red, qty <= 0) with progress bars and "Needs immediate restock" labels
- Shows all low stock products (amber, qty > 0 && qty <= reorderLevel) with restock quantity suggestions
- Each product shows: name, category, current stock, reorder level, visual progress bar
- Total count of affected items in the dialog description
- Tip section at bottom suggesting 2x reorder level restocking

### Feature 2: Notification Center
- **Component**: `NotificationCenter` - A Sheet that opens from the right side when Bell icon is clicked
- Fetches products (low/out of stock), rentals (overdue), debt (large outstanding >50k KES)
- Auto-calculates unread notification count
- Each notification has: severity icon, title, description, timestamp, unread dot indicator
- Color-coded: Red for critical (out of stock, overdue rental), Amber for warning (low stock, large debt)
- "Mark all read" button
- Click a notification to navigate to the relevant tab (inventory, rentals, customers)
- Unread badge count shown on notification center header

### Changes Made
1. **Imports**: Added Sheet, Progress, useRef, new lucide icons, rentalsApi, debtApi, RentalItem, DebtLedgerItem
2. **New Components**: NotificationCenter (~220 lines), LowStockAlertDialog (~165 lines)
3. **DashboardStats**: Added `onLowStockClick` prop, made Low Stock card clickable with hover effects and keyboard accessibility
4. **AppSidebar**: Added `notificationOpen` state, replaced `toast.info` with NotificationCenter Sheet, added `currentStoreId`
5. **POSTab**: Added `lowStockAlertOpen` state, wired onLowStockClick to DashboardStats, added LowStockAlertDialog

### Verification
- ESLint passes with no errors on page.tsx
- Dev server running, all APIs responding (200 status codes)
- No new npm packages added
