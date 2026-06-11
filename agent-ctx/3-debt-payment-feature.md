# Task 3: Customer Debt Payment Feature

## Agent: Feature Developer

## Task
Add a Customer Debt Payment dialog to the Customers tab in the MBUMAH HARDWARE POS & ERP System.

## Work Log

### Changes Made to `/home/z/my-project/src/app/tabs/customers-tab.tsx`

1. **Added new imports**: `HandCoins`, `Banknote`, `Smartphone` icons from lucide-react; `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from shadcn/ui select component.

2. **Added state variables**:
   - `debtPaymentOpen` (boolean) - controls payment dialog visibility
   - `debtPaymentAmount` (string) - payment amount input
   - `debtPaymentMethod` (string) - CASH or MPESA
   - `debtPaymentReference` (string) - optional reference number
   - `selectedDebtLedgerId` (string) - which debt record to pay against
   - Added `queryClient` via `useQueryClient()`

3. **Added `debtPaymentMutation`** using `useMutation`:
   - Calls `debtApi.makePayment()` with debtLedgerId, amount, paymentMethod, reference
   - On success: shows toast with new balance, invalidates customers and debt queries, resets form, closes dialog
   - On error: shows error toast

4. **Added computed values**:
   - `activeDebts` - filters out SETTLED debts
   - `paymentAmountNum` - parsed payment amount
   - `selectedDebt` - the currently selected debt record
   - `currentDebtBalance` - balance of selected debt or customer's total debt
   - `newBalancePreview` - preview of balance after payment

5. **Added "Record Payment" button** in Customer Detail Sheet:
   - Only shows when `currentDebtBalance > 0`
   - Uses accent-orange button style matching the rest of the app
   - Auto-selects first active debt when clicked
   - Opens the payment dialog

6. **Added Debt Payment Dialog** with:
   - Title: "Record Debt Payment" with HandCoins icon
   - Customer name and current balance display in info card
   - Debt record selector (when multiple active debts exist)
   - Amount input with KES prefix
   - Quick amount buttons (Full Amount, Half, KES 5,000, KES 10,000)
   - Payment method select (CASH with Banknote icon, MPESA with Smartphone icon)
   - Reference number input (optional, contextual placeholder)
   - New balance preview with overpayment warning
   - Submit and Cancel buttons with proper validation

7. **Edge case handling**:
   - Amount capped at current balance on submit (`Math.min`)
   - Warning shown when amount exceeds balance
   - Submit disabled when amount <= 0 or no debt selected
   - Green balance shown when fully paid off (newBalance === 0)
   - Form reset on dialog close (both cancel and after submission)

## Lint Result
- `customers-tab.tsx` passes ESLint with zero errors
- Only pre-existing `runner.js` errors remain (unrelated to this change)

## Stage Summary
- Customer Debt Payment feature fully implemented
- Dialog includes all required fields: customer info, amount, payment method, reference, quick amounts, balance preview
- Uses existing shadcn/ui components (Dialog, Input, Select, Button, Label, Badge)
- Follows existing code patterns and accent-orange style
- TypeScript types correct throughout
- Proper edge case handling (overpayment, empty amount, no debt selected)
