#  COMPREHENSIVE : ENTERPRISE HARDWARE STORE POS SYSTEM

## PROJECT EXECUTIVE SUMMARY

Build a **complete, production-ready, enterprise-grade Hardware Store Point of Sale (POS) System** with multi-tenancy support, real-time inventory management, advanced financial accounting, and integrated payment systems. The system must serve multiple independent hardware stores through a single platform while maintaining data isolation and supporting both cloud (Vercel/GitHub Pages) and local self-hosted deployments.

---

## SECTION 1: TECHNICAL STACK & ARCHITECTURE SPECIFICATIONS

### 1.1 Frontend Stack
```
- Framework: Next.js 14+ (App Router, React 18+, TypeScript)
- UI Library: Shadcn/UI + TailwindCSS 3.x for enterprise-grade UI
- State Management: Zustand + React Query (TanStack Query v5+)
- Real-time Updates: Socket.io Client + Tanstack Virtual for large lists
- Charts & Analytics: Recharts + Chart.js for financial dashboards
- Form Management: React Hook Form + Zod validation
- Styling: TailwindCSS with custom enterprise color schemes
- Authentication: NextAuth.js v5 with JWT + Session management
- Data Export: xlsx (Excel), papaparse (CSV), jsPDF (Receipts)
- QR Code Generation: qrcode.react for inventory tracking
- Barcode Scanning: jsbarcode for POS entry
- Notifications: React Toastify + Custom Toast System
- Date Management: dayjs
- File Upload: react-dropzone with image compression
```

### 1.2 Backend Stack
```
- Runtime: Node.js 20.x LTS
- Framework: NestJS 10.x (with strict TypeScript)
- ORM: TypeORM 0.3.x or Prisma 5.x (recommended: Prisma for better migrations)
- Database: PostgreSQL 15+ (production) | SQLite (local development)
- Cache Layer: Redis 7.x for session, inventory cache, rate limiting
- Message Queue: Bull/BullMQ for async operations (receipts, notifications)
- API Documentation: Swagger/OpenAPI 3.1
- Validation: class-validator, class-transformer
- Logging: Winston + Morgan (HTTP logging)
- Error Tracking: Sentry integration
- Environment Management: dotenv
```

### 1.3 Microservices Architecture
```
Core Services:
├── API Gateway (Port 3000)
├── Auth Service (Port 3001) - JWT, RBAC, permissions
├── POS Service (Port 3002) - Sales transactions, checkout
├── Inventory Service (Port 3003) - Stock, products, warehouses
├── Payment Service (Port 3004) - M-Pesa, Cash, Debt tracking
├── Reporting Service (Port 3005) - Analytics, reports, exports
├── Notification Service (Port 3006) - Email, WhatsApp, SMS
├── Customer Service (Port 3007) - CRM, debt management
├── Accounting Service (Port 3008) - Financial records, ledger
├── Admin Service (Port 3009) - System management, backup/restore
└── Cache/Queue Service (Redis + Bull) - Background jobs

Communication: gRPC or REST APIs with circuit breakers
Service Discovery: Docker Compose / Manual configuration
```

### 1.4 Database Architecture
```
Primary DB: PostgreSQL (production) with read replicas
Cache Layer: Redis (inventory, sessions, OTP)
Backup Strategy: Automated daily snapshots + Point-in-time recovery
Replication: WAL-based for data consistency
Connection Pooling: PgBouncer or native pooling (min: 10, max: 50)
Search Indexing: Full-text search on products, customers
Audit Trail: Immutable transaction logs in separate schema
```

### 1.5 Deployment Architecture
```
Cloud Deployment (Vercel + GitHub):
├── Vercel: Frontend (Next.js) + API Routes (Serverless)
├── GitHub Actions: CI/CD Pipeline
├── Vercel Postgres: Managed PostgreSQL
├── Vercel Redis: Managed Redis
├── Vercel Blob: File storage for receipts/documents
└── S3/MinIO: Document storage alternative

Local/Self-Hosted (Docker):
├── Docker Compose orchestration
├── PostgreSQL in container
├── Redis in container
├── All microservices in containers
├── Nginx as reverse proxy
└── Automated health checks + restarts
```

---

## SECTION 2: DATABASE SCHEMA (NORMALIZED, PRODUCTION-READY)

### 2.1 Core Tables

```sql
-- Multi-tenancy
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE,
  logo_url TEXT,
  phone VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100),
  subscription_tier ENUM('free', 'basic', 'professional', 'enterprise'),
  subscription_ends_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}', -- theme, currency, tax_rate, etc
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP -- soft delete
);

-- Stores (physical locations)
CREATE TABLE stores (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20) UNIQUE,
  address TEXT,
  phone VARCHAR(20),
  manager_id UUID REFERENCES users(id),
  opening_time TIME,
  closing_time TIME,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, code)
);

-- Users & RBAC
CREATE TABLE users (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  store_id UUID REFERENCES stores(id),
  username VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  profile_picture_url TEXT,
  status ENUM('active', 'inactive', 'suspended'),
  last_login_at TIMESTAMP,
  is_locked BOOLEAN DEFAULT false,
  lock_until TIMESTAMP,
  failed_login_attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(organization_id, username),
  UNIQUE(organization_id, email)
);

CREATE TABLE roles (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system_role BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  resource VARCHAR(100),
  action VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

CREATE TABLE user_roles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

-- Products & Categories
CREATE TABLE product_categories (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  parent_id UUID REFERENCES product_categories(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon_url TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, parent_id, name)
);

CREATE TABLE products (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  category_id UUID NOT NULL REFERENCES product_categories(id),
  sku VARCHAR(100) NOT NULL,
  barcode VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_of_measure ENUM('piece', 'kg', 'meter', 'liter', 'set', 'box', 'bundle'),
  cost_price DECIMAL(12,2),
  selling_price DECIMAL(12,2) NOT NULL,
  rental_price_per_day DECIMAL(12,2),
  rental_price_per_week DECIMAL(12,2),
  rental_price_per_month DECIMAL(12,2),
  minimum_stock_level INT,
  reorder_point INT,
  supplier_id UUID,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  allow_rental BOOLEAN DEFAULT false,
  tax_applicable BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(organization_id, sku),
  UNIQUE(organization_id, barcode)
);

CREATE TABLE product_attributes (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name VARCHAR(100),
  value VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Inventory Management
CREATE TABLE warehouse_stock (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_on_hand INT NOT NULL DEFAULT 0,
  quantity_available INT NOT NULL DEFAULT 0,
  quantity_reserved INT NOT NULL DEFAULT 0,
  quantity_damaged INT NOT NULL DEFAULT 0,
  last_counted_at TIMESTAMP,
  restock_date TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id),
  product_id UUID NOT NULL REFERENCES products(id),
  movement_type ENUM('purchase', 'sale', 'adjustment', 'damage', 'return', 'rental_out', 'rental_return'),
  quantity INT NOT NULL,
  reference_id UUID,
  reference_type VARCHAR(50),
  notes TEXT,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_store_product ON stock_movements(store_id, product_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  customer_type ENUM('walk-in', 'registered', 'wholesale', 'contractor'),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100),
  national_id VARCHAR(50),
  business_name VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  max_debt_limit DECIMAL(12,2),
  credit_status ENUM('active', 'suspended', 'blocked'),
  total_debt DECIMAL(12,2) DEFAULT 0,
  total_spent DECIMAL(12,2) DEFAULT 0,
  purchase_count INT DEFAULT 0,
  last_purchase_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE customer_debt (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id),
  original_amount DECIMAL(12,2) NOT NULL,
  remaining_amount DECIMAL(12,2) NOT NULL,
  due_date TIMESTAMP,
  status ENUM('active', 'overdue', 'partially_paid', 'paid'),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sales Transactions
CREATE TABLE sales_transactions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  sale_number VARCHAR(50) NOT NULL,
  customer_id UUID REFERENCES customers(id),
  cashier_id UUID NOT NULL REFERENCES users(id),
  subtotal DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  payment_method ENUM('cash', 'mpesa', 'debt', 'card', 'cheque') NOT NULL,
  payment_status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
  mpesa_transaction_id VARCHAR(100),
  debt_id UUID REFERENCES customer_debt(id),
  notes TEXT,
  receipt_printed BOOLEAN DEFAULT false,
  receipt_emailed BOOLEAN DEFAULT false,
  receipt_smssent BOOLEAN DEFAULT false,
  receipt_whatsapp_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE(organization_id, sale_number)
);

CREATE TABLE sale_items (
  id UUID PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity DECIMAL(10,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  tax_rate DECIMAL(5,2),
  tax_amount DECIMAL(12,2),
  line_total DECIMAL(12,2) NOT NULL,
  item_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Rental Management
CREATE TABLE equipment_rentals (
  id UUID PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id),
  product_id UUID NOT NULL REFERENCES products(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  rental_type ENUM('daily', 'weekly', 'monthly') NOT NULL,
  quantity INT NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  rate_per_unit DECIMAL(12,2) NOT NULL,
  deposit_amount DECIMAL(12,2),
  total_rental_cost DECIMAL(12,2) NOT NULL,
  status ENUM('active', 'returned', 'overdue', 'damaged') DEFAULT 'active',
  damage_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  returned_at TIMESTAMP
);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  sale_id UUID REFERENCES sales_transactions(id),
  debt_id UUID REFERENCES customer_debt(id),
  rental_id UUID REFERENCES equipment_rentals(id),
  payment_method ENUM('cash', 'mpesa', 'card', 'cheque') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reference_number VARCHAR(100),
  mpesa_receipt_number VARCHAR(100),
  payment_status ENUM('pending', 'confirmed', 'failed') DEFAULT 'pending',
  recorded_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

-- Suppliers
CREATE TABLE suppliers (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  payment_terms VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  po_number VARCHAR(50) NOT NULL,
  order_date TIMESTAMP DEFAULT NOW(),
  expected_delivery_date TIMESTAMP,
  actual_delivery_date TIMESTAMP,
  subtotal DECIMAL(12,2),
  tax_amount DECIMAL(12,2),
  total DECIMAL(12,2),
  status ENUM('draft', 'confirmed', 'delivered', 'invoiced') DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, po_number)
);

CREATE TABLE po_items (
  id UUID PRIMARY KEY,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity_ordered INT NOT NULL,
  quantity_received INT DEFAULT 0,
  unit_cost DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Financial Records (General Ledger)
CREATE TABLE journal_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  store_id UUID REFERENCES stores(id),
  entry_date TIMESTAMP DEFAULT NOW(),
  reference_id UUID,
  reference_type VARCHAR(50),
  description TEXT,
  total_debit DECIMAL(12,2),
  total_credit DECIMAL(12,2),
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE journal_entry_lines (
  id UUID PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  debit DECIMAL(12,2) DEFAULT 0,
  credit DECIMAL(12,2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  account_number VARCHAR(20) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  account_type ENUM('asset', 'liability', 'equity', 'revenue', 'expense'),
  parent_account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, account_number)
);

-- System Logs
CREATE TABLE system_logs (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100),
  resource_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_system_logs_user ON system_logs(user_id, created_at);
CREATE INDEX idx_system_logs_resource ON system_logs(resource_type, resource_id);

CREATE TABLE error_logs (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  service_name VARCHAR(100),
  error_code VARCHAR(20),
  error_message TEXT,
  stack_trace TEXT,
  request_path VARCHAR(500),
  request_method VARCHAR(10),
  user_id UUID REFERENCES users(id),
  severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Backup & Restore
CREATE TABLE system_snapshots (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  snapshot_name VARCHAR(255) NOT NULL,
  snapshot_timestamp TIMESTAMP NOT NULL,
  metadata JSONB,
  backup_size_bytes BIGINT,
  status ENUM('in_progress', 'completed', 'failed') DEFAULT 'in_progress',
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Receipts & Documents
CREATE TABLE receipts (
  id UUID PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES sales_transactions(id),
  receipt_number VARCHAR(50) NOT NULL,
  pdf_url TEXT,
  html_content TEXT,
  total_amount DECIMAL(12,2),
  issued_at TIMESTAMP DEFAULT NOW(),
  email_sent_at TIMESTAMP,
  sms_sent_at TIMESTAMP,
  whatsapp_sent_at TIMESTAMP,
  UNIQUE(sale_id)
);
```

### 2.2 Database Optimization Strategies

```sql
-- Full-text search index for products
CREATE INDEX idx_products_search ON products 
USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

-- Financial queries optimization
CREATE INDEX idx_sales_date_store ON sales_transactions(store_id, created_at DESC);
CREATE INDEX idx_sales_payment_method ON sales_transactions(payment_method, created_at);
CREATE INDEX idx_journal_entries_date ON journal_entries(organization_id, entry_date DESC);

-- Inventory queries
CREATE INDEX idx_warehouse_stock_low ON warehouse_stock 
WHERE quantity_on_hand <= (SELECT reorder_point FROM products p WHERE p.id = product_id);

-- Customer queries
CREATE INDEX idx_customers_debt ON customers WHERE total_debt > 0;

-- Materialized views for reporting
CREATE MATERIALIZED VIEW daily_sales_summary AS
SELECT 
  st.store_id,
  DATE(st.created_at) as sale_date,
  st.payment_method,
  COUNT(*) as transaction_count,
  SUM(st.total_amount) as total_sales,
  SUM(st.tax_amount) as total_tax
FROM sales_transactions st
GROUP BY st.store_id, DATE(st.created_at), st.payment_method;

CREATE MATERIALIZED VIEW monthly_financial_summary AS
SELECT 
  organization_id,
  store_id,
  DATE_TRUNC('month', created_at) as month,
  SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END) as cash_sales,
  SUM(CASE WHEN payment_method = 'mpesa' THEN total_amount ELSE 0 END) as mpesa_sales,
  SUM(CASE WHEN payment_method = 'debt' THEN total_amount ELSE 0 END) as debt_sales,
  SUM(tax_amount) as total_tax
FROM sales_transactions
GROUP BY organization_id, store_id, DATE_TRUNC('month', created_at);
```

---

## SECTION 3: CORE FEATURES SPECIFICATION

### 3.1 Point of Sale (POS) Module

#### 3.1.1 Sales Entry & Checkout
```
Features:
- Barcode scanning with duplicate prevention
- Manual SKU search with autocomplete
- Quantity entry with decimal support (for kg, meters, etc)
- Real-time stock validation (prevent overselling)
- Quick add to cart with Ctrl+Enter
- Remove/Edit line items from cart
- Apply discounts (percentage or fixed amount, with reasons)
- Tax calculation (automatic per product & manual override)
- Payment method selection (Cash, M-Pesa, Debt, Card)
- Customer lookup by phone/name (for debt tracking)
- Debt limit validation
- Receipt preview before completion
- Transaction logging and error recovery
- Support for batch quantity entry
```

#### 3.1.2 Payment Processing
```
Cash:
- Amount tendered
- Change calculation
- Denomination breakdown (visual)

M-Pesa Integration:
- API integration with Daraja API (production + sandbox)
- QR code generation for payment
- STK Push for automatic prompt
- Webhook for payment confirmation
- Real-time payment status (polling + webhook)
- Error handling (timeout, network, invalid amount)
- Transaction reference tracking
- Daily M-Pesa reconciliation

Debt/Credit:
- Debt limit validation
- Debt status (active, overdue, suspended)
- Due date setting
- Automatic notification for overdue debt

Card Payments (Future):
- Stripe integration placeholder
- Processing fee calculation
```

#### 3.1.3 Rental Management
```
- Select rental duration (daily, weekly, monthly)
- Automatic cost calculation
- Deposit collection
- Return tracking
- Damage assessment & additional charges
- Automatic overdue detection
```

### 3.2 Inventory Management Module

#### 3.2.1 Stock Tracking
```
Features:
- Real-time quantity tracking per store
- Multiple warehouses per store support
- Stock status indicators (in-stock, low-stock, out-of-stock)
- Automatic reorder point alerts
- Damaged goods tracking
- Stock allocation for pending orders
- Stock movement history with user tracking
- Batch/Serial number tracking (optional)
- Expiry date management (future)
- Stock count/Physical verification
- Cycle counting workflows
- Stock transfer between stores
- Negative stock prevention (with override capability)
```

#### 3.2.2 Product Management
```
- Multiple categories with sub-categories
- SKU auto-generation with custom format
- Barcode generation & assignment
- Multiple units of measure (piece, kg, meter, liter, set, box, bundle)
- Cost & selling price management
- Price history tracking
- Supplier assignment
- Product images with compression
- Bulk product import (CSV/Excel)
- Product attributes (color, size, brand, etc)
- Search indexing for fast lookup
- Product availability by store
```

#### 3.2.3 Supplier Management
```
- Supplier master data
- Contact information & payment terms
- Purchase order creation
- Delivery tracking
- Invoice matching
- Supplier performance metrics
```

### 3.3 Financial & Accounting Module

#### 3.3.1 General Ledger
```
- Chart of Accounts (COA) with hierarchy
- Double-entry bookkeeping (debits = credits)
- Automatic journal entry creation from:
  - Sales transactions
  - Debt transactions
  - Payments received
  - Expenses
- Manual journal entry capability
- Trial balance report
- Balance sheet generation
- Income statement generation
```

#### 3.3.2 Daily Cash Management
```
- Sales summary by payment method
- Cash vs system discrepancies
- Bank deposit slips
- Cash reconciliation workflow
- Float management
```

#### 3.3.3 Debt Management
```
- Debt creation from sales
- Debt list with status (active, overdue, partially paid, paid)
- Payment posting to debt
- Overdue tracking & aging report
- Debt write-off capability
- Debt collection reminders (SMS/Email/WhatsApp)
- Late payment fees
```

### 3.4 Reporting & Analytics Module

#### 3.4.1 Sales Reports
```
Reports:
- Daily sales summary
  - Total sales, quantity, transactions
  - By payment method
  - By product/category
  - By cashier
  - By customer
  
- Weekly sales summary
  - Comparison with previous week
  - Top products
  - Trend analysis
  
- Monthly sales summary
  - Monthly totals
  - Year-to-date comparison
  - Seasonal trends
  
- Product performance
  - Best sellers
  - Slow movers
  - Revenue by product
  - Profitability analysis
  
- Cashier performance
  - Sales per cashier
  - Average transaction value
  - Error rate
```

#### 3.4.2 Financial Reports
```
- Cash flow statement
- Profit & loss statement
- Balance sheet
- Tax reports (VAT, sales tax)
- Debt aging report
- Expense summary
- Budget variance analysis
```

#### 3.4.3 Inventory Reports
```
- Stock status by product
- Low stock alerts
- Slow-moving inventory
- Dead stock report
- Stock turnover ratio
- Inventory value report
- Stock movement history
```

#### 3.4.4 Data Export
```
- CSV export (all reports)
- Excel export with formatting
- PDF export (with branding)
- Email reports (scheduled)
- Custom report builder
- Batch download
```

### 3.5 Customer Management Module

#### 3.5.1 Customer Database
```
- Customer registration (walk-in, registered)
- Merchant/wholesale classification
- Customer contact information
- Address management
- Credit limit setting
- Customer tier/classification
- Purchase history tracking
- Debt tracking & visibility
- Birthday/anniversary tracking (for loyalty)
```

#### 3.5.2 Customer Loyalty
```
- Points accumulation
- Points redemption
- Tiered discounts
- Special offers
```

#### 3.5.3 Customer Communication
```
- SMS reminders (debt, promotions)
- Email newsletters
- WhatsApp business messages
- In-app notifications
```

### 3.6 Notification & Communication Module

#### 3.6.1 Receipt Delivery
```
Channels:
- Print (thermal printer or standard printer)
- Email
- SMS (M-Pesa style short receipt)
- WhatsApp (formatted message with items)
- QR code for online receipt lookup

Content:
- Store name & logo
- Transaction details
- Item list with prices
- Tax breakdown
- Payment method & reference
- Customer details
- Return policy
```

#### 3.6.2 Customer Notifications
```
- Debt reminders (daily, weekly)
- Overdue payment alerts
- Payment confirmation
- Order status updates
- Promotional messages
```

#### 3.6.3 Admin Notifications
```
- Low stock alerts
- Daily sales summary
- Payment discrepancies
- System errors
- Backup completion
```

### 3.7 System Administration Module

#### 3.7.1 Admin Dashboard (Auto-Load on Boot)
```
Features:
- System health status
- Active user sessions
- Database status
- Service status (all microservices)
- Today's sales summary
- Top products
- Critical alerts
- Recent errors/logs
- Backup status
- Performance metrics

Actions:
- Manual system backup
- Snapshot management
- Service restart
- Cache clearing
- Report generation
```

#### 3.7.2 User Management
```
- User CRUD operations
- Role assignment
- Store assignment
- Permission management
- Login history
- Account lockout management
- Password reset workflows
- 2FA setup (TOTP/SMS)
```

#### 3.7.3 Organization Settings
```
- Business information
- Store configuration
- Payment method settings (M-Pesa API keys, etc)
- Email configuration
- SMS/WhatsApp provider setup
- Tax configuration
- Receipt customization
- Backup schedule
- Theme & branding
```

#### 3.7.4 Backup & Restore
```
Features:
- Automated daily backups
- Point-in-time restore capability
- Manual backup triggers
- Backup verification
- Backup retention policies
- Incremental backups
- Cross-region backup replication (cloud)
- One-click restore to specific point-in-time
- Backup integrity checks
- Backup size monitoring
```

#### 3.7.5 Audit & Logging
```
- User activity logging
  - Login/logout
  - Data access
  - Data modifications
  - Deletions (soft-delete audit trail)

- Error logging
  - Service errors with stack trace
  - User-facing errors
  - API errors
  - Database errors
  - Integration errors

- System events
  - Backup completion
  - Service restarts
  - Configuration changes
  - Permission changes

- Compliance logging (future)
  - GDPR compliance
  - Data retention policies
  - Audit trails for regulatory reporting
```

### 3.8 Error Handling & Recovery

#### 3.8.1 Error Handling Strategy
```
Approach:
- Try-catch wrappers on all operations
- Service-level error codes (1000-9999)
- User-friendly error messages
- Technical error logs (server-side only)
- Graceful degradation

Error Categories:
1. Validation Errors (400)
   - User input validation
   - Business logic violations
   - Stock/limit violations

2. Authorization Errors (403)
   - Permission denied
   - Invalid token
   - Role restriction

3. Not Found Errors (404)
   - Resource not found
   - Store not found
   - Customer not found

4. Conflict Errors (409)
   - Duplicate entry
   - Concurrent modification
   - Stock oversell

5. Server Errors (500)
   - Database connection failure
   - Service unavailable
   - Integration failure
   - Unexpected exceptions

6. Integration Errors
   - M-Pesa API timeout
   - Email service failure
   - SMS service failure
   - External service unreachable

Error Recovery:
- Automatic retry with exponential backoff
- Circuit breaker pattern for external services
- Transaction rollback on failure
- Queue failed messages for retry
- Alert admin on critical errors
```

#### 3.8.2 Self-Healing Mechanisms
```
- Database connection pool recovery
- Automatic reconnection on disconnect
- Stale cache invalidation
- Orphaned transaction cleanup
- Duplicate payment detection & deduplication
- Index rebuild on performance degradation
- Dead letter queue for failed messages
- Automatic retry of failed notifications
```

### 3.9 Multi-Store Management

```
Features:
- Centralized inventory management
- Store-specific inventory levels
- Inter-store transfers
- Consolidated reporting
- Per-store settings
- Store-specific users
- Organization-wide permissions
- Multi-store dashboard
- Inventory rebalancing across stores
- Centralized supplier management
```

### 3.10 Search Algorithm & Indexing

```
Implementation:
- PostgreSQL full-text search for products
- Elasticsearch integration (optional, for large scale)
- Typeahead/autocomplete on product search
- Customer search by name/phone/ID
- Advanced search filters
  - Category
  - Price range
  - Stock status
  - Supplier

Optimization:
- Search caching (Redis)
- Index maintenance
- Query optimization
- Result pagination
```

---

## SECTION 4: API SPECIFICATIONS (REST + gRPC)

### 4.1 Authentication API
```
POST /api/auth/login
  Body: { username, password }
  Response: { access_token, refresh_token, user }

POST /api/auth/register
  Body: { email, password, organization_name }
  Response: { user, organization }

POST /api/auth/refresh
  Body: { refresh_token }
  Response: { access_token }

POST /api/auth/logout
  Response: { success }

POST /api/auth/2fa/setup
  Response: { qr_code_url }

POST /api/auth/2fa/verify
  Body: { token }
  Response: { verified }
```

### 4.2 Sales API
```
POST /api/sales/transactions
  Body: {
    store_id, customer_id, items: [{product_id, quantity}],
    payment_method, discount_reason
  }
  Response: { transaction_id, receipt }

GET /api/sales/transactions/:id
  Response: { transaction details }

POST /api/sales/transactions/:id/complete
  Body: { payment_reference }
  Response: { transaction }

GET /api/sales/transactions (with filters)
  Query: store_id, date_from, date_to, payment_method
  Response: { transactions: [], total, count }

POST /api/sales/transactions/:id/refund
  Body: { items, reason }
  Response: { refund_id, receipt }

POST /api/sales/verify-stock
  Body: { items: [{product_id, quantity}] }
  Response: { available, conflicts }
```

### 4.3 Inventory API
```
GET /api/inventory/stock/:store_id
  Response: { products: [{product_id, quantity_on_hand, etc}] }

POST /api/inventory/stock/adjust
  Body: { store_id, product_id, quantity_change, reason }
  Response: { new_quantity }

POST /api/inventory/stock-transfer
  Body: { from_store_id, to_store_id, items }
  Response: { transfer_id }

GET /api/inventory/low-stock/:store_id
  Response: { products: [] }

POST /api/inventory/products
  Body: { sku, name, category_id, selling_price }
  Response: { product_id }

GET /api/inventory/products (with search)
  Query: q, category_id, store_id
  Response: { products: [], count }

POST /api/inventory/products/import
  Body: FormData { file }
  Response: { imported_count, errors }
```

### 4.4 Payments API
```
POST /api/payments/mpesa/initiate
  Body: { phone_number, amount, account_reference }
  Response: { checkout_request_id }

GET /api/payments/mpesa/:request_id/status
  Response: { status, result_code, result_description }

POST /api/payments/mpesa/webhook
  Body: { CheckoutRequestID, ResultCode, ... }
  Response: { success }

POST /api/payments/record-payment
  Body: { sale_id, amount, payment_method, reference }
  Response: { payment_id }

GET /api/payments/daily-reconciliation/:store_id/:date
  Response: { cash_receipts, mpesa_receipts, discrepancies }
```

### 4.5 Customers API
```
POST /api/customers
  Body: { name, phone, email, customer_type }
  Response: { customer_id }

GET /api/customers/:id
  Response: { customer details, debt, purchase history }

GET /api/customers (with search)
  Query: q, customer_type
  Response: { customers: [], count }

GET /api/customers/:id/debt
  Response: { total_debt, debts: [] }

POST /api/customers/:id/debt/payment
  Body: { amount, payment_method, reference }
  Response: { remaining_debt }

POST /api/customers/:id/set-credit-limit
  Body: { credit_limit }
  Response: { customer }
```

### 4.6 Reporting API
```
GET /api/reports/daily-sales/:store_id/:date
  Response: { total_sales, transactions, by_payment_method }

GET /api/reports/weekly-sales/:store_id/:week
  Response: { weekly_summary, comparison }

GET /api/reports/monthly-sales/:store_id/:month
  Response: { monthly_summary, year_comparison }

GET /api/reports/product-performance/:store_id
  Query: month, category_id
  Response: { products: [{name, quantity_sold, revenue}] }

GET /api/reports/financial/:org_id/:month
  Response: { p&l, cash_flow, balance_sheet }

POST /api/reports/export
  Body: { report_type, format, filters }
  Response: { download_url }

GET /api/reports/custom
  Query: date_from, date_to, metrics[], groupby
  Response: { custom_report }
```

### 4.7 Admin API
```
GET /api/admin/dashboard
  Response: { sales_summary, alerts, service_status }

POST /api/admin/backup
  Response: { backup_id, status }

GET /api/admin/backups
  Response: { backups: [] }

POST /api/admin/restore/:backup_id
  Response: { success, restored_at }

GET /api/admin/system-logs
  Query: user_id, action, date_from, date_to
  Response: { logs: [] }

GET /api/admin/error-logs
  Query: severity, service_name, is_resolved
  Response: { errors: [] }

POST /api/admin/error-logs/:id/resolve
  Response: { error }
```

---

## SECTION 5: FRONTEND REQUIREMENTS & USER FLOWS

### 5.1 Page Structure

```
Root Layout:
├── Auth Pages
│   ├── Login
│   ├── Register
│   ├── 2FA Setup
│   └── Forgot Password
│
├── Protected Routes (Authenticated)
│   ├── Dashboard
│   │   ├── Sales Summary
│   │   ├── Inventory Status
│   │   ├── Financial Summary
│   │   └── Alerts
│   │
│   ├── POS
│   │   ├── Sales Entry
│   │   ├── Active Transactions
│   │   ├── Transaction History
│   │   └── Receipt Management
│   │
│   ├── Inventory
│   │   ├── Stock Levels
│   │   ├── Product Management
│   │   ├── Stock Adjustments
│   │   ├── Stock Transfers
│   │   ├── Supplier Management
│   │   └── Purchase Orders
│   │
│   ├── Customers
│   │   ├── Customer List
│   │   ├── Customer Details
│   │   ├── Debt Management
│   │   └── Loyalty Programs
│   │
│   ├── Financial
│   │   ├── General Ledger
│   │   ├── Chart of Accounts
│   │   ├── Journal Entries
│   │   ├── Reports (P&L, Balance Sheet)
│   │   ├── Cash Management
│   │   └── Debt Tracking
│   │
│   ├── Reports
│   │   ├── Sales Reports
│   │   ├── Inventory Reports
│   │   ├── Financial Reports
│   │   ├── Custom Report Builder
│   │   └── Report Scheduling
│   │
│   ├── Admin
│   │   ├── Dashboard
│   │   ├── User Management
│   │   ├── Role Management
│   │   ├── Organization Settings
│   │   ├── Backup & Restore
│   │   ├── System Logs
│   │   ├── Error Logs
│   │   └── Integration Settings
│   │
│   └── Settings
│       ├── Profile
│       ├── Security
│       ├── Notifications
│       └── Preferences
```

### 5.2 Core UI Components (Shadcn/UI based)

```
Data Display:
- Data Tables with sorting, filtering, pagination
- Charts (line, bar, pie)
- Cards with metrics
- Tabs & Accordions
- Badges for status

Forms & Input:
- Input fields with validation
- Select dropdowns with search
- Date pickers
- Number inputs with currency formatting
- Text areas
- Checkboxes & Radio buttons
- File upload

Modals & Overlays:
- Confirm dialogs
- Action sheets
- Side panels
- Toasts & Notifications

Navigation:
- Top navbar with user menu
- Sidebar with collapsible menu
- Breadcrumbs
- Mobile-responsive hamburger menu
```

### 5.3 Mobile Responsiveness

```
- Fully responsive design (mobile first)
- Touch-friendly buttons (48px minimum)
- Mobile POS interface
  - Large buttons for quick scanning
  - Simplified checkout flow
  - Mobile-optimized keyboard
- Offline mode for POS (service worker)
- Data sync when online
```

### 5.4 Keyboard Shortcuts & UX

```
POS Shortcuts:
- Ctrl+Enter: Add item to cart
- Ctrl+S: Complete sale
- F2: New transaction
- F3: Customer search
- F4: Discount entry
- F5: Refund
- Esc: Clear/Cancel

Navigation Shortcuts:
- Ctrl+D: Dashboard
- Ctrl+P: POS
- Ctrl+I: Inventory
- Ctrl+R: Reports
- Ctrl+A: Admin

Global:
- Ctrl+K: Command palette
- Ctrl+/: Help
- Alt+Theme: Toggle dark mode
```

---

## SECTION 6: MICROSERVICES ARCHITECTURE DETAILS

### 6.1 Service Communication

```
API Gateway (Port 3000):
├── Authentication middleware
├── Rate limiting
├── Request logging
├── Error handling
└── Service routing

Services communicate via:
- REST APIs (HTTP/JSON)
- gRPC for internal services (high-performance)
- Message Queue (Bull/Redis) for async operations

Service Discovery:
- Manual configuration in .env (development)
- Service registry (production) or Docker Compose DNS
```

### 6.2 Async Operations (Queue System)

```
Tasks queued via Bull:
- Email notifications
- SMS sending
- WhatsApp messages
- Report generation
- Backup operations
- Data export
- Stock level calculations
- Notification batching
- Image optimization

Job retries:
- 3 attempts with exponential backoff
- Dead letter queue for failed jobs
- Admin visibility into job status
```

### 6.3 Service Responsibilities

```
Auth Service:
- User authentication & authorization
- JWT token generation & validation
- RBAC enforcement
- Session management
- 2FA handling

POS Service:
- Sales transaction creation
- Shopping cart management
- Checkout workflow
- Transaction validation
- Stock reservation

Inventory Service:
- Stock level management
- Product catalog
- Stock movements
- Supplier management
- Purchase orders

Payment Service:
- M-Pesa integration
- Payment recording
- Reconciliation
- Refund handling
- Payment status tracking

Reporting Service:
- Report generation
- Data aggregation
- Export operations
- Cached report serving
- Scheduled reports

Notification Service:
- Email sending (SMTP)
- SMS sending (Twilio/Africa's Talking)
- WhatsApp messaging
- In-app notifications
- Notification templates

Customer Service:
- Customer CRUD
- Debt tracking
- Purchase history
- Customer search

Accounting Service:
- General ledger management
- Journal entry creation
- Financial report generation
- Budget tracking

Admin Service:
- System configuration
- Backup/restore operations
- User management
- System monitoring
- Audit logging
```

---

## SECTION 7: DEPLOYMENT & DEVOPS

### 7.1 Local Development (Docker Compose)

```yaml
# docker-compose.yml structure
services:
  api-gateway:
    build: ./services/api-gateway
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
    
  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: hardware_pos
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/
    
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    
  [other services similarly configured]
  
volumes:
  postgres_data:
```

### 7.2 Cloud Deployment (Vercel + GitHub)

```
Vercel Configuration:
├── Frontend (Next.js)
│   ├── Automatic deployments from main branch
│   ├── Preview deployments for PRs
│   ├── Environment variables per environment
│   └── Vercel Postgres (managed DB)
│
├── API Routes (Serverless)
│   ├── /api/auth/*
│   ├── /api/sales/*
│   ├── /api/inventory/*
│   └── [other routes as serverless functions]
│
└── Edge Middleware
    ├── Authentication
    ├── Rate limiting
    └── Request logging

GitHub Actions CI/CD:
├── Lint & format check
├── Unit tests
├── Integration tests
├── Build verification
├── Security scanning (Dependabot)
├── Deployment trigger (on merge to main)
└── Post-deployment tests
```

### 7.3 Self-Hosted Deployment

```
Server Setup (Ubuntu 22.04 LTS):
├── Docker & Docker Compose
├── Nginx reverse proxy
├── SSL/TLS (Let's Encrypt)
├── PostgreSQL backup cron jobs
├── System monitoring (Prometheus + Grafana)
├── Logging (ELK stack)
└── Health checks & auto-restart

Nginx Configuration:
├── Frontend static serving
├── API route proxying
├── SSL termination
├── Gzip compression
├── Cache headers
└── Security headers
```

---

## SECTION 8: SECURITY SPECIFICATIONS

### 8.1 Authentication & Authorization

```
- JWT with 15min expiry + refresh tokens (7 days)
- Password requirements: 12+ chars, mixed case, numbers, symbols
- Bcrypt password hashing (cost: 12)
- Account lockout after 5 failed attempts (30min cooldown)
- 2FA (TOTP + SMS options)
- Session management with Redis
- CORS properly configured
- CSRF protection on forms
- Rate limiting (100 requests/minute per IP)
```

### 8.2 Data Security

```
- Database encryption at rest
- SSL/TLS for all data in transit
- Sensitive data fields encrypted (SSN, card numbers if stored)
- Password reset tokens with 1-hour expiry
- Soft deletes (no permanent data loss without audit)
- Audit trail for all data modifications
- Data retention policies per organization
```

### 8.3 API Security

```
- API key authentication for service-to-service
- OAuth2 for third-party integrations
- Request signing for critical operations
- Response validation & sanitization
- Input validation & sanitization
- SQL injection prevention (parameterized queries)
- XSS prevention (output encoding)
- CSRF protection
- Content Security Policy (CSP) headers
- Security headers (HSTS, X-Frame-Options, etc)
```

### 8.4 Payment Security

```
- PCI DSS compliance (for M-Pesa integration)
- Never store full M-Pesa credentials in code
- Use environment variables + secrets manager
- Webhook signature verification
- HTTPS only for payment APIs
- Encryption of payment transaction details
- Audit trail for all payment operations
```

---

## SECTION 9: TESTING STRATEGY

### 9.1 Test Coverage

```
Unit Tests (80%+ coverage):
- Service logic
- API endpoints
- Utility functions
- Database models

Integration Tests (50%+ coverage):
- API flows (create order, complete payment, etc)
- Database transactions
- Service interactions
- External integrations (mock APIs)

E2E Tests (critical user flows):
- Login → Sales → Receipt
- Customer → Add Debt → Payment
- Inventory → Stock Adjustment → Report
- Admin → Backup → Restore

Performance Tests:
- Load testing (100+ concurrent users)
- Database query optimization
- API response times
- Report generation speed
```

### 9.2 Testing Stack

```
- Jest (unit & integration tests)
- Supertest (API testing)
- Cypress (E2E testing)
- Artillery (load testing)
- Mock data using Faker.js
- Test database seeding
```

---

## SECTION 10: MONITORING & OBSERVABILITY

### 10.1 Logging

```
Structured Logging:
- Winston logger with JSON formatting
- Log levels: debug, info, warn, error, critical
- Request ID tracking (correlation IDs)
- User & organization context in logs
- Performance metrics (query time, API latency)

Log Aggregation:
- ELK Stack or similar (production)
- Searchable logs by user, action, resource
- Log retention: 90 days (configurable)
- Alerts for error spikes
```

### 10.2 Monitoring

```
Metrics:
- API response times
- Error rates
- Database query performance
- Cache hit rates
- Message queue depths
- Service availability

Dashboards:
- Real-time service health
- Error rates & types
- API latency percentiles (p50, p95, p99)
- Database connection pool usage
- Queue processing times

Alerting:
- Service down (critical)
- Error rate > 5% (high)
- P95 latency > 2s (medium)
- Database errors (high)
- Payment API failures (critical)
```

---

## SECTION 11: INTEGRATION REQUIREMENTS

### 11.1 M-Pesa Integration (Daraja API)

```
Implementation:
- Consumer Key & Secret from Safaricom
- OAuth2 authentication flow
- STK Push for customer-initiated payments
- Query Transaction API for status checks
- Webhook for payment confirmations
- Reconciliation at end of day
- Error handling for network timeouts
- Duplicate payment prevention
- Transaction logging

Features:
- Real-time payment confirmation
- Automatic ledger entry on payment
- Payment reference tracking
- Daily settlement reports
```

### 11.2 Email Integration

```
Provider: SendGrid / AWS SES / SMTP
Capabilities:
- Transactional emails (receipts, confirmations)
- Template-based emails
- HTML & text versions
- Attachment support (PDFs)
- Bulk sending with throttling
- Delivery tracking
- Bounce handling
```

### 11.3 SMS Integration

```
Provider: Africa's Talking / Twilio / Vonage
Use Cases:
- Debt reminders
- Payment confirmations
- OTP delivery
- Order notifications
- Promotional messages
- Short receipts

Features:
- Character encoding (Unicode support for Kiswahili)
- Delivery reports
- Scheduled sending
- Bulk SMS batching
```

### 11.4 WhatsApp Business Integration

```
Provider: Meta Business API
Features:
- Template-based messages
- Interactive menus
- Media attachments
- Receipt delivery
- Debt reminders
- Order updates
- Group notifications

Implementation:
- Webhook for incoming messages
- Message queueing for reliability
- Rate limiting per customer
```

---

## SECTION 12: PERFORMANCE OPTIMIZATION

### 12.1 Database Optimization

```
- Connection pooling (PgBouncer)
- Query optimization (EXPLAIN ANALYZE)
- Indexing strategy for frequently queried columns
- Materialized views for expensive aggregations
- Partitioning for large tables (sales by month)
- Read replicas for reporting queries
- Query caching (Redis)
```

### 12.2 Caching Strategy

```
Cache Layers:
1. Browser cache (static assets, 1 year)
2. HTTP cache (API responses, 5-60 minutes)
3. Application cache (Redis)
   - Product catalog (1 hour)
   - Store settings (1 hour)
   - User permissions (30 minutes)
   - Stock levels (5 minutes)
4. Database query cache (automatic, powered by indexes)

Cache Invalidation:
- Time-based expiry
- Event-based invalidation (on data change)
- Manual invalidation by admin
```

### 12.3 Frontend Performance

```
- Code splitting by route
- Lazy loading of components
- Image optimization & compression
- CSS/JS minification & compression
- Service Workers for offline capability
- Virtual scrolling for large lists
- Pagination over infinite scroll
- Debouncing of search/filter inputs
```

---

## SECTION 13: ERROR HANDLING & USER EXPERIENCE

### 13.1 Error Message Strategy

```
User-Facing Errors:
- Clear, non-technical language
- Specific guidance on resolution
- Suggested next steps
- Contact support if unresolvable

Examples:
❌ Bad: "Internal Server Error 500"
✅ Good: "Unable to process payment right now. Please try again in a few minutes or contact support."

❌ Bad: "FK constraint violation"
✅ Good: "Cannot delete this product as it has existing sales records."

❌ Bad: "Timeout error"
✅ Good: "Payment is taking longer than expected. Check M-Pesa balance or try again."
```

### 13.2 Graceful Degradation

```
Partial Service Failures:
- If M-Pesa API down: Allow cash/debt sales only, queue M-Pesa payments
- If Email down: Queue emails for retry, show notification
- If SMS down: Allow WhatsApp alternative
- If Inventory Service down: Display cached data, allow readonly access
- If Reports down: Show cached reports, notify of limitations
```

### 13.3 Transaction Safety

```
Features:
- Optimistic locking to prevent overselling
- Distributed transactions with saga pattern
- Idempotency keys for payment operations
- Automatic rollback on any failure
- User-friendly rollback notifications
- Transaction logs for auditability
```

---

## SECTION 14: COMPLIANCE & DATA GOVERNANCE

### 14.1 Regulatory Compliance

```
- GDPR (if serving EU customers)
  - Data privacy consent
  - Right to be forgotten (data deletion)
  - Data export capability
  
- Local Tax Compliance
  - VAT/Sales Tax tracking
  - Tax report generation
  - Transaction auditing for tax authority
  
- Business Laws
  - Receipt generation requirements
  - Transaction logging
  - Data retention policies
```

### 14.2 Data Governance

```
- Data classification (public, internal, confidential)
- Data retention policies (by organization)
- Data deletion schedules
- GDPR compliance (PII handling)
- Privacy policy enforcement
- Terms of service acceptance
```

---

## SECTION 15: FUTURE ENHANCEMENTS (Roadmap)

```
Phase 2:
- Loyalty program with points & rewards
- Purchase analytics with ML predictions
- Supplier management with cost optimization
- Equipment rental with calendar integration
- Multi-currency support
- Barcode/RFID inventory tracking
- Advanced financial reporting
- Consignment inventory management

Phase 3:
- Mobile app (Flutter) with offline POS
- AI-powered demand forecasting
- Customer behavior analytics
- Dynamic pricing
- Supply chain optimization
- Budget management with variance analysis
- API for third-party integrations

Phase 4:
- B2B marketplace for suppliers
- Cloud synchronization for multiple devices
- Video receipt delivery
- Voice-based inventory updates
- Advanced fraud detection
- Carbon footprint tracking
```

---

## SECTION 16: DEVELOPMENT WORKFLOW & GUIDELINES

### 16.1 Project Structure

```
hardware-pos-system/
├── frontend/
│   ├── app/ (Next.js App Router)
│   ├── components/
│   ├── lib/
│   ├── styles/
│   ├── public/
│   ├── types/
│   └── next.config.js
│
├── backend/
│   ├── services/
│   │   ├── api-gateway/
│   │   ├── auth-service/
│   │   ├── pos-service/
│   │   ├── inventory-service/
│   │   ├── payment-service/
│   │   ├── reporting-service/
│   │   ├── notification-service/
│   │   ├── customer-service/
│   │   ├── accounting-service/
│   │   └── admin-service/
│   ├── shared/ (common code)
│   │   ├── database/
│   │   ├── decorators/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── pipes/
│   │   └── utils/
│   ├── docker-compose.yml
│   └── .env.example
│
├── infrastructure/
│   ├── docker/
│   ├── kubernetes/ (optional)
│   ├── nginx.conf
│   └── scripts/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── USER_GUIDE.md
│
├── .github/
│   └── workflows/ (CI/CD)
│
└── README.md
```

### 16.2 Development Standards

```
Code Quality:
- TypeScript strict mode
- ESLint for linting
- Prettier for formatting
- Pre-commit hooks (Husky)
- Unit test before commit

Naming Conventions:
- Files: kebab-case (user-service.ts)
- Functions/Variables: camelCase
- Classes: PascalCase
- Constants: UPPER_SNAKE_CASE
- Enums: PascalCase
- Interfaces: PascalCase with I prefix (IUser)

Commit Messages:
- feat: Add new feature
- fix: Bug fix
- refactor: Code refactoring
- docs: Documentation update
- test: Test-related changes
- chore: Maintenance

Environment Configuration:
- .env.example (committed)
- .env.local (gitignored)
- secrets manager for production
```

---

## EXECUTION INSTRUCTIONS FOR Z.AI

### PHASE 1: Foundation (Week 1-2)
1. Set up project structure & tooling
2. Create database schema & migrations
3. Implement authentication service
4. Set up basic API Gateway
5. Create frontend scaffold with routing
6. Deploy to staging environment

### PHASE 2: Core Features (Week 3-6)
1. Implement POS module (sales, checkout)
2. Implement Inventory module
3. Implement Payments module (M-Pesa integration)
4. Implement Customer module
5. Create admin dashboard
6. Set up logging & monitoring

### PHASE 3: Advanced Features (Week 7-10)
1. Implement Financial/Accounting module
2. Implement Reporting & Analytics
3. Implement Notification system (Email, SMS, WhatsApp)
4. Implement Backup & Restore
5. Complete RBAC system
6. Add search & indexing

### PHASE 4: Polish & Deploy (Week 11-12)
1. Comprehensive testing
2. Performance optimization
3. Security hardening
4. Documentation
5. Production deployment
6. User training materials

---

## CRITICAL SUCCESS FACTORS

1. **User-Centric Design**: Interface must be intuitive for non-technical store staff
2. **Data Integrity**: No lost or duplicated transactions
3. **Reliability**: 99.9% uptime (max 45 minutes downtime/month)
4. **Performance**: Sales entry must complete in <2 seconds
5. **Scalability**: Support 1,000+ concurrent users
6. **Maintainability**: Clear code, good documentation, easy debugging
7. **Extensibility**: Easy to add new features without breaking existing ones
8. **Security**: Industry-standard practices, regular audits

---

## END OF PROMPT

**FINAL INSTRUCTION TO **:
Create a complete, production-ready Hardware Store POS System following all specifications above. Prioritize robustness, user experience, and maintainability. Use the latest versions of specified frameworks. Implement proper error handling, logging, and security throughout. Provide detailed comments in code. Generate comprehensive documentation and setup instructions.

Start with the database schema and core services, then build the frontend and integrations. Deploy to both cloud (Vercel) and local (Docker) environments. Ensure all features are fully functional and tested before marking complete.
