// ─────────────────────────────────────────────────────────────────────────────
// Zod validation schema tests
// ─────────────────────────────────────────────────────────────────────────────
//
// Pure-logic tests for all validation schemas defined in `@/lib/validations`:
//   • Product validation (name, SKU, price boundaries)
//   • Customer validation (email, phone format)
//   • Sale/checkout validation (items, payment method, negative quantities)
//   • User validation (create, update, login)
//   • Expense validation
//   • Gift card validation
//   • The validateInput helper wrapper
//
// No database required — all tests are pure Zod parsing.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  checkoutSchema,
  createCustomerSchema,
  createProductSchema,
  createExpenseSchema,
  createGiftCardSchema,
  validateInput,
} from '@/lib/validations';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Login validation
// ─────────────────────────────────────────────────────────────────────────────

describe('loginSchema', () => {
  it('accepts valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'mypassword123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing email', () => {
    const result = loginSchema.safeParse({ password: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts password up to 128 characters', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(128),
    });
    expect(result.success).toBe(true);
  });

  it('rejects password over 128 characters', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. User validation (create / update)
// ─────────────────────────────────────────────────────────────────────────────

describe('createUserSchema', () => {
  const validUser = {
    name: 'John Doe',
    email: 'john@example.com',
    role: 'CASHIER',
    password: 'securePass123',
  };

  it('accepts valid user data', () => {
    const result = createUserSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it('rejects name shorter than 2 characters', () => {
    const result = createUserSchema.safeParse({ ...validUser, name: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects password shorter than 6 characters', () => {
    const result = createUserSchema.safeParse({ ...validUser, password: '12345' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = createUserSchema.safeParse({ ...validUser, role: 'HACKER' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid roles', () => {
    const roles = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'];
    for (const role of roles) {
      const result = createUserSchema.safeParse({ ...validUser, role });
      expect(result.success, `role ${role} should be valid`).toBe(true);
    }
  });

  it('accepts optional phone and storeId', () => {
    const result = createUserSchema.safeParse({
      ...validUser,
      phone: '+254712345678',
      storeId: 'store_123',
    });
    expect(result.success).toBe(true);
  });
});

describe('updateUserSchema', () => {
  it('allows updating only name', () => {
    const result = updateUserSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('allows updating only email', () => {
    const result = updateUserSchema.safeParse({ email: 'new@example.com' });
    expect(result.success).toBe(true);
  });

  it('allows updating isActive', () => {
    const result = updateUserSchema.safeParse({ isActive: false });
    expect(result.success).toBe(true);
  });

  it('allows nullable storeId', () => {
    const result = updateUserSchema.safeParse({ storeId: null });
    expect(result.success).toBe(true);
  });

  it('allows empty object (no changes)', () => {
    const result = updateUserSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Product validation
// ─────────────────────────────────────────────────────────────────────────────

describe('createProductSchema', () => {
  const validProduct = {
    storeId: 'store_123',
    sku: 'NAIL-001',
    name: '2-inch Nails',
    unitType: 'PIECE',
    quantityInStock: 100,
    reorderLevel: 10,
    pricePerUnit: 5.00,
    costPrice: 3.00,
    taxRate: 16,
  };

  it('accepts valid product data', () => {
    const result = createProductSchema.safeParse(validProduct);
    expect(result.success).toBe(true);
  });

  it('rejects missing storeId', () => {
    const { storeId, ...noStore } = validProduct;
    const result = createProductSchema.safeParse(noStore);
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createProductSchema.safeParse({ ...validProduct, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 characters', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      name: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative price', () => {
    const result = createProductSchema.safeParse({ ...validProduct, pricePerUnit: -10 });
    expect(result.success).toBe(false);
  });

  it('rejects zero price', () => {
    const result = createProductSchema.safeParse({ ...validProduct, pricePerUnit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative cost price', () => {
    const result = createProductSchema.safeParse({ ...validProduct, costPrice: -5 });
    expect(result.success).toBe(false);
  });

  it('allows zero cost price', () => {
    const result = createProductSchema.safeParse({ ...validProduct, costPrice: 0 });
    expect(result.success).toBe(true);
  });

  it('rejects negative quantity', () => {
    const result = createProductSchema.safeParse({ ...validProduct, quantityInStock: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative reorder level', () => {
    const result = createProductSchema.safeParse({ ...validProduct, reorderLevel: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects tax rate > 100', () => {
    const result = createProductSchema.safeParse({ ...validProduct, taxRate: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects tax rate < 0', () => {
    const result = createProductSchema.safeParse({ ...validProduct, taxRate: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid unit types', () => {
    const units = ['PIECE', 'KILOGRAM', 'METER', 'LITER', 'BAG', 'BOX', 'SET'];
    for (const unit of units) {
      const result = createProductSchema.safeParse({ ...validProduct, unitType: unit });
      expect(result.success, `unitType ${unit} should be valid`).toBe(true);
    }
  });

  it('rejects invalid unit type', () => {
    const result = createProductSchema.safeParse({ ...validProduct, unitType: 'DOZEN' });
    expect(result.success).toBe(false);
  });

  it('accepts optional isRental and isBundle', () => {
    const result = createProductSchema.safeParse({
      ...validProduct,
      isRental: true,
      isBundle: false,
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Customer validation
// ─────────────────────────────────────────────────────────────────────────────

describe('createCustomerSchema', () => {
  const validCustomer = {
    storeId: 'store_123',
    name: 'Jane Customer',
  };

  it('accepts minimal valid customer (name + storeId)', () => {
    const result = createCustomerSchema.safeParse(validCustomer);
    expect(result.success).toBe(true);
  });

  it('accepts valid email', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      email: 'jane@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty string email', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      email: '',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      email: 'not-valid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts phone up to 20 characters', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      phone: '+2547123456789012345', // exactly 20 chars
    });
    expect(result.success).toBe(true);
  });

  it('rejects phone over 20 characters', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      phone: '+254712345678901234567',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 characters', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      name: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts debt limit as non-negative', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      debtLimit: 50000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative debt limit', () => {
    const result = createCustomerSchema.safeParse({
      ...validCustomer,
      debtLimit: -100,
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Checkout / Sale validation
// ─────────────────────────────────────────────────────────────────────────────

describe('checkoutSchema', () => {
  const validItem = {
    productId: 'prod_1',
    productName: 'Nails',
    sku: 'NAIL-001',
    quantity: 2,
    unitType: 'PIECE',
    pricePerUnit: 5,
    costPrice: 3,
    discountPercent: 0,
    taxRate: 16,
  };

  const validCheckout = {
    storeId: 'store_123',
    cashierId: 'user_1',
    items: [validItem],
    paymentMethod: 'CASH',
  };

  it('accepts valid checkout with CASH payment', () => {
    const result = checkoutSchema.safeParse(validCheckout);
    expect(result.success).toBe(true);
  });

  it('accepts all valid payment methods', () => {
    const methods = ['CASH', 'MPESA', 'DEBT', 'SPLIT', 'GIFT_CARD'];
    for (const method of methods) {
      const result = checkoutSchema.safeParse({ ...validCheckout, paymentMethod: method });
      expect(result.success, `payment method ${method} should be valid`).toBe(true);
    }
  });

  it('rejects invalid payment method', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, paymentMethod: 'CRYPTO' });
    expect(result.success).toBe(false);
  });

  it('requires at least one item', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, items: [] });
    expect(result.success).toBe(false);
  });

  it('rejects negative quantity', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, quantity: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero quantity', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('coerces string quantities to numbers', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, quantity: '3' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].quantity).toBe(3);
    }
  });

  it('rejects negative price', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, pricePerUnit: -5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative cost price', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, costPrice: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects discount percent > 100', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, discountPercent: 101 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects tax rate > 100', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, taxRate: 150 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing productId', () => {
    const { productId, ...noId } = validItem;
    const result = checkoutSchema.safeParse({ ...validCheckout, items: [noId] });
    expect(result.success).toBe(false);
  });

  it('accepts split payment details', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      paymentMethod: 'SPLIT',
      paymentDetails: {
        splits: [
          { method: 'CASH', amount: 500 },
          { method: 'MPESA', amount: 660 },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects split items with negative amount', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      paymentMethod: 'SPLIT',
      paymentDetails: {
        splits: [
          { method: 'CASH', amount: -100 },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional notes', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      notes: 'Customer requested a bag',
    });
    expect(result.success).toBe(true);
  });

  it('rejects notes over 1000 characters', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      notes: 'A'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional isRentalItem and isBundle on items', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ ...validItem, isRentalItem: true, isBundle: false }],
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Expense validation
// ─────────────────────────────────────────────────────────────────────────────

describe('createExpenseSchema', () => {
  const validExpense = {
    storeId: 'store_123',
    description: 'Electricity bill',
    amount: 5000,
    category: 'Utilities',
  };

  it('accepts valid expense', () => {
    const result = createExpenseSchema.safeParse(validExpense);
    expect(result.success).toBe(true);
  });

  it('rejects zero amount', () => {
    const result = createExpenseSchema.safeParse({ ...validExpense, amount: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = createExpenseSchema.safeParse({ ...validExpense, amount: -100 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid payment methods', () => {
    const methods = ['CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE'];
    for (const method of methods) {
      const result = createExpenseSchema.safeParse({ ...validExpense, paymentMethod: method });
      expect(result.success, `expense payment ${method} should be valid`).toBe(true);
    }
  });

  it('rejects description over 500 characters', () => {
    const result = createExpenseSchema.safeParse({
      ...validExpense,
      description: 'A'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Gift card validation
// ─────────────────────────────────────────────────────────────────────────────

describe('createGiftCardSchema', () => {
  const validGiftCard = {
    storeId: 'store_123',
    reason: 'PROMOTION',
    initialBalance: 1000,
  };

  it('accepts valid gift card', () => {
    const result = createGiftCardSchema.safeParse(validGiftCard);
    expect(result.success).toBe(true);
  });

  it('rejects negative balance', () => {
    const result = createGiftCardSchema.safeParse({ ...validGiftCard, initialBalance: -50 });
    expect(result.success).toBe(false);
  });

  it('rejects zero balance', () => {
    const result = createGiftCardSchema.safeParse({ ...validGiftCard, initialBalance: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid reasons', () => {
    const reasons = [
      'CUSTOMER_LOYALTY', 'PROMOTION', 'REFUND_CREDIT', 'STORE_CREDIT',
      'GIFT', 'EMPLOYEE_AWARD', 'COMPLAINT_RESOLUTION', 'OTHER',
    ];
    for (const reason of reasons) {
      const result = createGiftCardSchema.safeParse({ ...validGiftCard, reason });
      expect(result.success, `reason ${reason} should be valid`).toBe(true);
    }
  });

  it('rejects invalid reason', () => {
    const result = createGiftCardSchema.safeParse({ ...validGiftCard, reason: 'BRIBE' });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. validateInput helper
// ─────────────────────────────────────────────────────────────────────────────

describe('validateInput helper', () => {
  it('returns success:true with parsed data for valid input', () => {
    const result = validateInput(createProductSchema, {
      storeId: 'store_1',
      sku: 'SKU-001',
      name: 'Test Product',
      unitType: 'PIECE',
      quantityInStock: 10,
      reorderLevel: 5,
      pricePerUnit: 100,
      costPrice: 50,
      taxRate: 16,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Product');
    }
  });

  it('returns success:false with error string for invalid input', () => {
    const result = validateInput(createProductSchema, { bad: 'data' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('error string contains field path for nested errors', () => {
    const result = validateInput(checkoutSchema, {
      storeId: 'store_1',
      cashierId: 'user_1',
      items: [{
        productId: 'p1',
        productName: 'Test',
        sku: 'S1',
        quantity: -5,
        unitType: 'PIECE',
        pricePerUnit: 10,
        costPrice: 5,
        discountPercent: 0,
        taxRate: 16,
      }],
      paymentMethod: 'CASH',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('items');
    }
  });
});
