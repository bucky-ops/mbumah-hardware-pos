-- PostgreSQL Initialization Script for MBUMAH HARDWARE POS
-- Enables pg_trgm extension for fuzzy/trigram search optimization

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create GIN indexes for fast fuzzy product search (when using PostgreSQL)
-- These are created after the tables exist via Prisma migration
-- Example: CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
-- Example: CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku_trgm ON products USING GIN (sku gin_trgm_ops);
-- Example: CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_description_trgm ON products USING GIN (description gin_trgm_ops);

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE mbumah_pos TO mbumah;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mbumah;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mbumah;

SELECT 'MBUMAH HARDWARE POS - PostgreSQL initialized with pg_trgm' AS status;
