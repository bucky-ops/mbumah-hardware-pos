// OpenAPI 3.0 specification for the MBUMAH HARDWARE POS & ERP API.
//
// AUDIT FIX (Finding 6.2 — missing API documentation): the README lists 60+
// endpoints but there was no machine-readable contract, so frontend/backend
// integration relied on reverse-engineering route handlers. This module is
// the canonical, hand-maintained contract for the highest-traffic surfaces:
//
//   • GET /api/openapi            — this document (public, no secrets)
//   • POST /api/auth/login
//   • GET/POST /api/products
//   • GET/POST /api/customers
//   • /api/debt-payment-plans (list/create, stats, item, approve,
//     installments, installment pay/waive) — the contract hardened in
//     DEBT_PLAN_MODULE_AUDIT.md / PR #18
//   • GET /api/health
//   • POST /api/payments/mpesa/stkpush + callback (rate limited, see PR for
//     the audit remediation)
//
// It is served as JSON at /api/openapi so it can be pasted into Swagger UI,
// Insomnia, or Postman, and can later drive client-SDK generation and
// contract tests. Keep it in sync with route handlers when changing request/
// response shapes — a follow-up issue tracks generating this automatically.
//
// NOTE: schemas intentionally describe the JSON envelope level (success/
// error/pagination) rather than every model field; exhaustive per-model
// schemas should be generated from the Prisma schema in a follow-up.

export const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'MBUMAH HARDWARE POS & ERP API',
    version: '2.2.0',
    description:
      'Multi-tenant Point-of-Sale and ERP API for Kenyan hardware stores. ' +
      'All authenticated endpoints require the session cookie issued by ' +
      'POST /api/auth/login. Store-scoped queries are automatically narrowed ' +
      "to the caller's store at the ORM layer (zero-trust tenancy).",
  },
  servers: [{ url: '/', description: 'Current deployment (relative)' }],
  tags: [
    { name: 'Health', description: 'Liveness / readiness' },
    { name: 'Auth', description: 'Session authentication' },
    { name: 'Products', description: 'Inventory catalogue' },
    { name: 'Customers', description: 'Customer book including credit' },
    { name: 'Debt Payment Plans', description: 'Structured debt repayment plans' },
    { name: 'Payments', description: 'M-Pesa STK push + Daraja callback' },
  ],
  paths: {
    '/api/openapi': {
      get: {
        tags: ['Health'],
        summary: 'This OpenAPI document',
        security: [],
        responses: { '200': { description: 'OpenAPI JSON' } },
      },
    },
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness + dependency checks (DB, env, integrity)',
        security: [],
        responses: {
          '200': {
            description: 'Healthy or degraded (warnings only)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
              },
            },
          },
          '503': { description: 'Unhealthy — a check reported error status' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange credentials for a session cookie',
        description:
          'Rate limited (5 attempts / 15 min / IP) with progressive account ' +
          'lockout after repeated failures.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Session established (HttpOnly cookie)' },
          '401': { description: 'Invalid credentials' },
          '423': { description: 'Account locked (brute-force protection)' },
          '429': { description: 'Rate limited — see Retry-After' },
        },
      },
    },
    '/api/products': {
      get: {
        tags: ['Products'],
        summary: 'List products (paginated)',
        parameters: [
          { name: 'storeId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'categoryId', in: 'query', schema: { type: 'string' } },
          { name: 'lowStock', in: 'query', schema: { type: 'boolean' } },
          { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['name', 'sku', 'pricePerUnit', 'quantityInStock', 'createdAt', 'updatedAt'] } },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: {
          '200': {
            description: 'Paginated product list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedProducts' },
              },
            },
          },
          '400': { description: 'storeId missing' },
          '401': { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Products'],
        summary: 'Create a product (MANAGER+ roles)',
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Missing required fields' },
          '403': { description: 'Role not permitted' },
          '409': { description: 'SKU or barcode already exists' },
        },
      },
    },
    '/api/customers': {
      get: {
        tags: ['Customers'],
        summary: 'List customers (paginated)',
        parameters: [
          { name: 'storeId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'hasDebt', in: 'query', schema: { type: 'boolean' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['name', 'phone', 'currentDebtBalance', 'loyaltyPoints', 'createdAt'] } },
        ],
        responses: {
          '200': {
            description: 'Paginated customer list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedCustomers' },
              },
            },
          },
        },
      },
      post: {
        tags: ['Customers'],
        summary: 'Create a customer',
        description:
          'Validation failures return the canonical 400 envelope with a ' +
          'per-field `errors` map for form highlighting.',
        responses: {
          '201': { description: 'Created' },
          '400': {
            description: 'Validation failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
              },
            },
          },
          '409': { description: 'Phone number already exists for this store' },
        },
      },
    },
    '/api/debt-payment-plans': {
      get: {
        tags: ['Debt Payment Plans'],
        summary: 'List payment plans (paginated, includes next due installment)',
        parameters: [
          { name: 'storeId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED'] } },
        ],
        responses: {
          '200': {
            description: 'Paginated plan list with per-plan nextInstallment',
          },
          '401': { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Debt Payment Plans'],
        summary: 'Create a plan from outstanding debt ledgers',
        description:
          'Validates installments against the (optionally interest-bearing) ' +
          'total; plan starts in PENDING_APPROVAL. Segregation of duties: the ' +
          'creator cannot approve their own plan.',
        responses: {
          '201': { description: 'Plan created (PENDING_APPROVAL)' },
          '400': { description: 'Validation failed (bounds, frequency, JSON)' },
          '404': { description: 'Customer not found in this store' },
        },
      },
    },
    '/api/debt-payment-plans/stats': {
      get: {
        tags: ['Debt Payment Plans'],
        summary: 'Aggregate plan KPIs for the caller’s store',
        responses: { '200': { description: 'Counts + outstanding totals by status' } },
      },
    },
    '/api/debt-payment-plans/{id}': {
      get: {
        tags: ['Debt Payment Plans'],
        summary: 'Fetch one plan with its installment schedule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Plan detail' },
          '404': { description: 'Not found in caller’s store (IDOR-safe)' },
        },
      },
      patch: {
        tags: ['Debt Payment Plans'],
        summary: 'Cancel a plan (or edit while PENDING_APPROVAL)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Updated' },
          '409': { description: 'Lifecycle violation (e.g. cancel COMPLETED)' },
        },
      },
      delete: {
        tags: ['Debt Payment Plans'],
        summary: 'Delete a plan (PENDING_APPROVAL only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '409': { description: 'Plan already approved' } },
      },
    },
    '/api/debt-payment-plans/{id}/approve': {
      post: {
        tags: ['Debt Payment Plans'],
        summary: 'Atomically approve a plan (ADMIN-eligible roles, not creator)',
        description:
          'Serialized approval: PENDING_APPROVAL → ACTIVE with approvedAt set. ' +
          'Concurrent approvals get 409 instead of double-activating.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Approved (ACTIVE, approvedAt stamped)' },
          '403': { description: 'Creator self-approval blocked / role denied' },
          '409': { description: 'Already approved or no longer pending' },
        },
      },
    },
    '/api/debt-payment-plans/{id}/installments': {
      get: {
        tags: ['Debt Payment Plans'],
        summary: 'List installments for a plan',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Installment rows (SCHEDULED/PARTIAL/PAID/WAIVED/OVERDUE)' } },
      },
    },
    '/api/debt-payment-plans/installments/{installmentId}/pay': {
      post: {
        tags: ['Debt Payment Plans'],
        summary: 'Record a payment against one installment',
        description:
          'Writes the payment, updates the installment (PARTIAL → PAID), and ' +
          'advances the plan lifecycle (COMPLETED when all installments settle; ' +
          'DEFAULTED plans can be recovered by payment).',
        parameters: [{ name: 'installmentId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Payment applied' },
          '400': { description: 'Amount bounds violation' },
          '409': { description: 'Installment not payable in current state' },
        },
      },
    },
    '/api/debt-payment-plans/installments/{installmentId}/waive': {
      post: {
        tags: ['Debt Payment Plans'],
        summary: 'Waive the UNPAID remainder of an installment (MANAGER+)',
        description:
          'Credits only the outstanding portion (principal + pro-rated ' +
          'interest), never the full amount when part is already paid.',
        parameters: [{ name: 'installmentId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Waiver applied — returns waivedAmount' },
          '400': { description: 'Nothing left to waive' },
          '409': { description: 'Installment not waivable in current state' },
        },
      },
    },
    '/api/payments/mpesa/stkpush': {
      post: {
        tags: ['Payments'],
        summary: 'Initiate an M-Pesa STK push (authenticated, rate limited)',
        responses: {
          '200': { description: 'Push initiated — CheckoutRequestID returned' },
          '429': { description: 'Rate limited (20/min/IP) — see Retry-After' },
        },
      },
    },
    '/api/payments/mpesa/callback': {
      post: {
        tags: ['Payments'],
        summary: 'Daraja STK result webhook (credentialed, rate limited)',
        description:
          'Public-but-credentialed (Basic auth + optional IP allowlist). ' +
          'Duplicate callbacks are idempotent; flood attempts get 429 and a ' +
          'SecurityEvent row.',
        security: [],
        responses: {
          '200': { description: 'Callback processed (or idempotent no-op)' },
          '401': { description: 'Bad credentials' },
          '403': { description: 'IP not allowlisted / mock rejected' },
          '429': { description: 'Rate limited (60/min/IP) — see Retry-After' },
        },
      },
    },
  },
  components: {
    schemas: {
      Pagination: {
        type: 'object',
        description: 'Canonical list meta (page/limit legacy names kept; booleans additive).',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 50 },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          hasNextPage: { type: 'boolean' },
          hasPreviousPage: { type: 'boolean' },
        },
      },
      PaginatedProducts: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { type: 'object', description: 'Product row (see Prisma schema)' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      PaginatedCustomers: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { type: 'object', description: 'Customer row + activeDebtCount + transactionCount' } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      },
      ValidationErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', description: 'Human-readable summary' },
          errors: {
            type: 'object',
            description: 'Per-field message map for form highlighting',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
          timestamp: { type: 'string', format: 'date-time' },
          nodeEnv: { type: 'string' },
          responseTime: { type: 'string', example: '42ms' },
          version: { type: 'string' },
          checks: { type: 'object', additionalProperties: { type: 'object' } },
        },
      },
    },
  },
} as const;
