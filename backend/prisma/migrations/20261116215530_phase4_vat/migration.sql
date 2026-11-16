-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('OUTPUT', 'INPUT');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "emirate" TEXT NOT NULL DEFAULT 'DUBAI',
ADD COLUMN     "inventory_method" TEXT NOT NULL DEFAULT 'WAVG';

-- AlterTable
ALTER TABLE "voucher_lines" ADD COLUMN     "tax_rate_id" UUID,
ADD COLUMN     "taxable_amount" DECIMAL(19,4);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "tax_rate_id" UUID NOT NULL,
    "direction" "TaxDirection" NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "emirate" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "taxable_amount" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,
    "is_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "is_reversal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_company_id_code_effective_from_key" ON "tax_rates"("company_id", "code", "effective_from");

-- CreateIndex
CREATE INDEX "tax_transactions_company_id_txn_date_idx" ON "tax_transactions"("company_id", "txn_date");

-- CreateIndex
CREATE INDEX "tax_transactions_company_id_source_type_source_id_idx" ON "tax_transactions"("company_id", "source_type", "source_id");

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
