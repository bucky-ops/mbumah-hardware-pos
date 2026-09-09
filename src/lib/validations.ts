import { z } from 'zod';

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required').max(128),
});

// User schemas
export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT']),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  phone: z.string().optional(),
  storeId: z.string().optional(),
  organizationId: z.string().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT']).optional(),
  phone: z.string().optional(),
  storeId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// Transaction schemas
export const checkoutSchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().optional(),
  cashierId: z.string().min(1),
  // SYS-10: client-generated idempotency key — a replayed checkout (lost
  // response, offline sync) returns the original transaction instead of
  // double-applying stock/payments/journals.
  idempotencyKey: z.string().min(8).max(100).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    productName: z.string().min(1),
    sku: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unitType: z.string().min(1),
    pricePerUnit: z.coerce.number().nonnegative(),
    costPrice: z.coerce.number().nonnegative(),
    discountPercent: z.coerce.number().min(0).max(100),
    taxRate: z.coerce.number().min(0).max(100),
    lineTotal: z.coerce.number().nonnegative().optional(),
    isRentalItem: z.boolean().optional(),
    isBundle: z.boolean().optional(),
  })).min(1, 'At least one item is required'),
  // F2-1: serialized-asset capture — serials are claimed (IN_STOCK → SOLD)
  // atomically inside the checkout transaction; a serial that is not IN_STOCK
  // in this store aborts the sale (double-sell protection).
  serials: z.array(z.object({
    productId: z.string().min(1),
    serial: z.string().min(3).max(100),
  })).max(200).optional(),
  paymentMethod: z.enum(['CASH', 'MPESA', 'DEBT', 'SPLIT', 'GIFT_CARD']),
  paymentDetails: z.object({
    cashAmount: z.coerce.number().optional(),
    mpesaPhone: z.string().optional(),
    debtAccountId: z.string().optional(),
    giftCardId: z.string().optional(),
    giftCardCode: z.string().optional(),
    voucherId: z.string().optional(),
    discountAmount: z.coerce.number().optional(),
    // SPLIT payments: array of { method, amount, reference? } so the checkout
    // can record multiple tenders (e.g. cash + M-Pesa) in one transaction.
    splits: z.array(z.object({
      // AUDIT FIX (1): DEBT is now a legal split-tender leg. Each DEBT leg is
      // treated exactly like a pure-DEBT sale inside the checkout transaction
      // (credit-limit enforcement, DebtLedger charge row, customer balance
      // increment, A/R debit in the journal) instead of a bare COMPLETED
      // Payment row that bypassed the customer's credit account.
      method: z.enum(['CASH', 'MPESA', 'GIFT_CARD', 'DEBT']),
      amount: z.coerce.number().positive(),
      reference: z.string().optional(),
      giftCardCode: z.string().optional(),
    })).optional(),
  }).optional(),
  discountAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  // AUDIT FIX (1): a DEBT split leg charges the customer's credit account, so
  // a customerId is MANDATORY — without one the DebtLedger charge row could
  // never be written and the credit limit could not be enforced.
  if (
    data.paymentMethod === 'SPLIT' &&
    data.paymentDetails?.splits?.some((s) => s.method === 'DEBT') &&
    !data.customerId
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['customerId'],
      message: 'Customer is required when a split payment includes a DEBT leg.',
    });
  }
});

// Customer schemas
export const createCustomerSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1).max(200),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(500).optional(),
  idNumber: z.string().max(50).optional(),
  debtLimit: z.number().nonnegative().optional(),
});

// Product schemas
export const createProductSchema = z.object({
  storeId: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  sku: z.string().min(1).max(50),
  barcode: z.string().max(50).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  unitType: z.enum(['PIECE', 'KILOGRAM', 'METER', 'LITER', 'BAG', 'BOX', 'SET']),
  quantityInStock: z.number().int().nonnegative(),
  reorderLevel: z.number().int().nonnegative(),
  pricePerUnit: z.number().positive(),
  costPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100),
  isRental: z.boolean().optional(),
  isBundle: z.boolean().optional(),
});

// Expense schemas
export const createExpenseSchema = z.object({
  storeId: z.string().min(1),
  description: z.string().min(1).max(500),
  amount: z.number().positive('Amount must be positive'),
  category: z.string().min(1).max(100),
  paidBy: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE']).optional(),
  notes: z.string().max(1000).optional(),
  date: z.string().optional(),
});

// Gift card schemas
export const createGiftCardSchema = z.object({
  storeId: z.string().min(1),
  code: z.string().max(20).optional(),
  reason: z.enum(['CUSTOMER_LOYALTY', 'PROMOTION', 'REFUND_CREDIT', 'STORE_CREDIT', 'GIFT', 'EMPLOYEE_AWARD', 'COMPLAINT_RESOLUTION', 'OTHER']),
  initialBalance: z.number().positive('Balance must be positive'),
  recipientName: z.string().max(200).optional(),
  recipientPhone: z.string().max(20).optional(),
  recipientEmail: z.string().email().optional().or(z.literal('')),
  customerId: z.string().optional(),
  expiryDate: z.string().optional(),
  autoAdjustItems: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

// Helper to validate and return parsed data or error response
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Zod v4 uses error.issues instead of error.errors
  const issues = result.error.issues || [];
  const errors = issues.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`).join('; ');
  return { success: false, error: errors };
}

// ── AUDIT FIX (Finding 1.4 — standardized validation response format) ────────
//
// The audit found API routes answered validation failures inconsistently —
// some returned 400 with a flat string, some leaked 500s, and no route
// exposed machine-readable per-field errors, so clients could not highlight
// the offending input. `validationErrorResponse` gives every route ONE
// canonical 400 shape:
//
//   {
//     "success": false,
//     "error": "human-readable summary",
//     "errors": { "fieldName": ["message", …], … }   // flat-field map
//   }
//
// Usage in a route handler:
//   const parsed = createProductSchema.safeParse(body);
//   if (!parsed.success) return validationErrorResponse(parsed.error);
//
// (The existing `validateInput` string form is kept for the routes already
// using it; both share the same status code and `success:false` contract.)

export interface ValidationFailure {
  success: false;
  error: string;
  /** Per-field map for client-side form highlighting. */
  errors: Record<string, string[]>;
}

export function validationErrorResponse(error: z.ZodError): Response {
  const issues = error.issues || [];
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!errors[field]) errors[field] = [];
    errors[field].push(issue.message);
  }
  const summary = issues
    .map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`)
    .join('; ');
  return Response.json(
    { success: false, error: summary || 'Validation failed.', errors },
    { status: 400 },
  );
}
