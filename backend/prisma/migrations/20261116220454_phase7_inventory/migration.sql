-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT', 'OPENING');

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "branch_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "uom_id" UUID,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "track_batch" BOOLEAN NOT NULL DEFAULT false,
    "track_serial" BOOLEAN NOT NULL DEFAULT false,
    "sale_price" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "purchase_price" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "tax_code" TEXT NOT NULL DEFAULT 'STD',
    "min_stock" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reorder_qty" DECIMAL(19,4),
    "income_account_id" UUID,
    "expense_account_id" UUID,
    "inventory_account_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "movement_date" DATE NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,6) NOT NULL,
    "total_cost" DECIMAL(19,4) NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATE,
    "source_type" TEXT,
    "source_id" UUID,
    "reversal_of_id" UUID,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_layers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "batch_no" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "remaining_qty" DECIMAL(19,4) NOT NULL,
    "unit_cost" DECIMAL(19,6) NOT NULL,

    CONSTRAINT "stock_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_serials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "serial_no" TEXT NOT NULL,
    "warehouse_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "cost" DECIMAL(19,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_serials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_company_id_name_key" ON "product_categories"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_company_id_code_key" ON "units_of_measure"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");

-- CreateIndex
CREATE INDEX "products_company_id_category_id_idx" ON "products"("company_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_sku_key" ON "products"("company_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_barcode_key" ON "products"("company_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reversal_of_id_key" ON "stock_movements"("reversal_of_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_product_id_warehouse_id_idx" ON "stock_movements"("company_id", "product_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_source_type_source_id_idx" ON "stock_movements"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_movement_date_idx" ON "stock_movements"("company_id", "movement_date");

-- CreateIndex
CREATE INDEX "stock_layers_company_id_product_id_warehouse_id_received_at_idx" ON "stock_layers"("company_id", "product_id", "warehouse_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_serials_company_id_product_id_serial_no_key" ON "stock_serials"("company_id", "product_id", "serial_no");

ALTER TABLE stock_layers ADD CONSTRAINT sl_remaining_non_negative CHECK (remaining_qty >= 0);
ALTER TABLE stock_movements ADD CONSTRAINT sm_nonzero CHECK (quantity <> 0);

-- ---- Row Level Security for every tenant table (idempotent; appended to each migration) ----
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = NULLIF(current_setting(''app.current_company_id'', true), '''')::uuid) WITH CHECK (company_id = NULLIF(current_setting(''app.current_company_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexerp_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexerp_app;
    REVOKE UPDATE, DELETE ON journal_entries, journal_entry_lines, audit_logs FROM nexerp_app;
  END IF;
END $$;
