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
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
    .max(128),
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
  items: z.array(z.object({
    productId: z.string().min(1),
    productName: z.string().min(1),
    sku: z.string().min(1),
    quantity: z.number().positive(),
    unitType: z.string().min(1),
    pricePerUnit: z.number().nonnegative(),
    costPrice: z.number().nonnegative(),
    discountPercent: z.number().min(0).max(100),
    taxRate: z.number().min(0).max(100),
    lineTotal: z.number().nonnegative(),
    isRentalItem: z.boolean(),
    isBundle: z.boolean(),
  })).min(1, 'At least one item is required'),
  paymentMethod: z.enum(['CASH', 'MPESA', 'DEBT', 'SPLIT']),
  paymentDetails: z.object({
    cashAmount: z.number().optional(),
    mpesaPhone: z.string().optional(),
    debtAccountId: z.string().optional(),
    giftCardId: z.string().optional(),
    voucherId: z.string().optional(),
    discountAmount: z.number().optional(),
  }).optional(),
  discountAmount: z.number().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
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
  // SECURITY (H-09): preferredChannel and isActive must go through Zod validation
  // rather than being read from the raw body, so that arbitrary / malicious values
  // cannot bypass the schema (e.g. a non-boolean isActive string, or a channel
  // outside the allowed set).
  preferredChannel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'PRINT']).optional(),
  isActive: z.boolean().optional(),
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
