-- =====================================================================
-- Tenant isolation (Row Level Security) + accounting integrity rules
-- The application connects as role "nexerp_app" (non-superuser, no BYPASSRLS)
-- and sets `app.current_company_id` per transaction (SET LOCAL semantics).
-- =====================================================================

-- 1. Row Level Security on every tenant table ---------------------------
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

-- 2. Value constraints ---------------------------------------------------
ALTER TABLE journal_entry_lines
  ADD CONSTRAINT jel_non_negative CHECK (debit >= 0 AND credit >= 0),
  ADD CONSTRAINT jel_one_sided    CHECK (debit = 0 OR credit = 0),
  ADD CONSTRAINT jel_has_amount   CHECK (debit > 0 OR credit > 0);

ALTER TABLE voucher_lines
  ADD CONSTRAINT vl_non_negative CHECK (debit >= 0 AND credit >= 0),
  ADD CONSTRAINT vl_one_sided    CHECK (debit = 0 OR credit = 0);

ALTER TABLE journal_entries ADD CONSTRAINT je_rate_positive CHECK (exchange_rate > 0);
ALTER TABLE exchange_rates  ADD CONSTRAINT fx_rate_positive CHECK (rate > 0);
ALTER TABLE financial_years ADD CONSTRAINT fy_dates CHECK (end_date > start_date);
ALTER TABLE accounting_periods ADD CONSTRAINT ap_dates CHECK (end_date >= start_date);

-- 3. Journal balance: debit = credit, enforced at COMMIT ----------------
CREATE OR REPLACE FUNCTION nexerp_check_journal_line() RETURNS trigger AS $$
DECLARE
  d numeric; c numeric; n int; entry_company uuid; acct_company uuid;
BEGIN
  SELECT company_id INTO entry_company FROM journal_entries WHERE id = NEW.entry_id;
  IF entry_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Journal line company does not match journal entry company';
  END IF;
  SELECT company_id INTO acct_company FROM accounts WHERE id = NEW.account_id;
  IF acct_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Journal line account belongs to a different company';
  END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*) INTO d, c, n
    FROM journal_entry_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Unbalanced journal entry %: debit % <> credit %', NEW.entry_id, d, c;
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'Journal entry % must have at least two lines', NEW.entry_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION nexerp_check_journal_line();

-- 4. Immutability of posted journals and audit logs ----------------------
CREATE OR REPLACE FUNCTION nexerp_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: posted accounting records are immutable. Use a reversal entry.', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_immutable  BEFORE UPDATE OR DELETE ON journal_entries      FOR EACH ROW EXECUTE FUNCTION nexerp_forbid_mutation();
CREATE TRIGGER trg_jel_immutable BEFORE UPDATE OR DELETE ON journal_entry_lines FOR EACH ROW EXECUTE FUNCTION nexerp_forbid_mutation();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs         FOR EACH ROW EXECUTE FUNCTION nexerp_forbid_mutation();

-- 5. Period lock enforced in the database too -----------------------------
CREATE OR REPLACE FUNCTION nexerp_check_period_open() RETURNS trigger AS $$
DECLARE p record;
BEGIN
  SELECT status, start_date, end_date, company_id INTO p FROM accounting_periods WHERE id = NEW.period_id;
  IF p.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Accounting period belongs to a different company';
  END IF;
  IF p.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Accounting period is locked';
  END IF;
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    RAISE EXCEPTION 'Entry date % is outside the accounting period', NEW.entry_date;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_period BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION nexerp_check_period_open();

-- 6. Privileges for the application role ----------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexerp_app') THEN
    GRANT USAGE ON SCHEMA public TO nexerp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexerp_app;
    REVOKE UPDATE, DELETE ON journal_entries, journal_entry_lines, audit_logs FROM nexerp_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexerp_app;
  END IF;
END $$;
