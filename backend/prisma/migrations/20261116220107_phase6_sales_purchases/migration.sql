-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "DocSide" AS ENUM ('SALES', 'PURCHASE');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('QUOTATION', 'REQUEST', 'ORDER', 'GRN', 'INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'POSTED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('RECEIPT', 'PAYMENT');

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trn" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contact_person" TEXT,
    "credit_limit" DECIMAL(19,4),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "account_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "side" "DocSide" NOT NULL,
    "type" "DocType" NOT NULL,
    "number" TEXT NOT NULL,
    "party_id" UUID NOT NULL,
    "doc_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(19,8) NOT NULL DEFAULT 1,
    "prices_include_vat" BOOLEAN NOT NULL DEFAULT false,
    "net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "vat" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "source_doc_id" UUID,
    "voucher_id" UUID,
    "warehouse_id" UUID,
    "project_id" UUID,
    "recurring_id" UUID,
    "created_by" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_rate_id" UUID,
    "net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "vat" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "gross" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "account_id" UUID,
    "warehouse_id" UUID,
    "batch_no" TEXT,
    "serial_nos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_line_id" UUID,
    "received_qty" DECIMAL(19,4) NOT NULL DEFAULT 0,

    CONSTRAINT "document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "number" TEXT NOT NULL,
    "party_id" UUID NOT NULL,
    "settle_date" DATE NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK',
    "reference" TEXT,
    "notes" TEXT,
    "voucher_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "settlement_id" UUID,
    "credit_document_id" UUID,
    "document_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "next_run_date" DATE NOT NULL,
    "end_date" DATE,
    "auto_post" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "template" JSONB NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_company_id_kind_idx" ON "parties"("company_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "parties_company_id_kind_code_key" ON "parties"("company_id", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "documents_voucher_id_key" ON "documents"("voucher_id");

-- CreateIndex
CREATE INDEX "documents_company_id_side_type_status_idx" ON "documents"("company_id", "side", "type", "status");

-- CreateIndex
CREATE INDEX "documents_company_id_party_id_idx" ON "documents"("company_id", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_company_id_side_type_number_key" ON "documents"("company_id", "side", "type", "number");

-- CreateIndex
CREATE UNIQUE INDEX "document_lines_document_id_line_no_key" ON "document_lines"("document_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_voucher_id_key" ON "settlements"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_company_id_kind_number_key" ON "settlements"("company_id", "kind", "number");

-- CreateIndex
CREATE INDEX "settlement_allocations_document_id_idx" ON "settlement_allocations"("document_id");

-- CreateIndex
CREATE INDEX "settlement_allocations_credit_document_id_idx" ON "settlement_allocations"("credit_document_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convenience views matching the specified table names (tenant RLS applies through security_invoker)
CREATE VIEW customers WITH (security_invoker = true) AS SELECT * FROM parties WHERE kind = 'CUSTOMER';
CREATE VIEW suppliers WITH (security_invoker = true) AS SELECT * FROM parties WHERE kind = 'SUPPLIER';
CREATE VIEW sales_invoices WITH (security_invoker = true) AS SELECT * FROM documents WHERE side = 'SALES' AND type = 'INVOICE';
CREATE VIEW purchase_invoices WITH (security_invoker = true) AS SELECT * FROM documents WHERE side = 'PURCHASE' AND type = 'INVOICE';
CREATE VIEW receipts WITH (security_invoker = true) AS SELECT * FROM settlements WHERE kind = 'RECEIPT';
CREATE VIEW payments WITH (security_invoker = true) AS SELECT * FROM settlements WHERE kind = 'PAYMENT';
ALTER TABLE document_lines ADD CONSTRAINT dl_qty_positive CHECK (quantity > 0);
ALTER TABLE settlements ADD CONSTRAINT st_amount_positive CHECK (amount > 0);
ALTER TABLE settlement_allocations ADD CONSTRAINT sa_amount_positive CHECK (amount > 0);

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
