-- DropIndex
DROP INDEX "stock_layers_company_id_product_id_warehouse_id_received_at_idx";

-- AlterTable
ALTER TABLE "stock_layers" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "stock_layers_company_id_product_id_warehouse_id_received_at_idx" ON "stock_layers"("company_id", "product_id", "warehouse_id", "received_at", "seq");

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

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexerp_app') THEN GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexerp_app; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nexerp_app; END IF; END $$;
