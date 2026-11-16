-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source_id" UUID,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "assigned_to" UUID,
    "expected_close" DATE,
    "converted_party_id" UUID,
    "lost_reason" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "party_id" UUID,
    "lead_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "lead_id" UUID,
    "party_id" UUID,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "activity_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6),
    "done_at" TIMESTAMPTZ(6),
    "reminded_at" TIMESTAMPTZ(6),
    "assigned_to" UUID,
    "created_by" UUID NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department_id" UUID,
    "designation_id" UUID,
    "user_id" UUID,
    "manager_id" UUID,
    "join_date" DATE NOT NULL,
    "date_of_birth" DATE,
    "nationality" TEXT,
    "emirates_id" TEXT,
    "passport_no" TEXT,
    "bank_name" TEXT,
    "iban" TEXT,
    "basic_salary" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "terminated_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "calc" TEXT NOT NULL DEFAULT 'FIXED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "employee_salary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "check_in" TEXT,
    "check_out" TEXT,
    "notes" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "days_per_year" INTEGER NOT NULL DEFAULT 0,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "days" DECIMAL(6,1) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "attachment_id" UUID,
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "total_gross" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_deduction" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "voucher_id" UUID,
    "pay_voucher_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "basic" DECIMAL(19,4) NOT NULL,
    "allowances" DECIMAL(19,4) NOT NULL,
    "deductions" DECIMAL(19,4) NOT NULL,
    "unpaid_days" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "gross" DECIMAL(19,4) NOT NULL,
    "net" DECIMAL(19,4) NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "requires_receipt" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DIRECT',
    "category_id" UUID NOT NULL,
    "employee_id" UUID,
    "project_id" UUID,
    "expense_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "net" DECIMAL(19,4) NOT NULL,
    "vat" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL,
    "tax_rate_id" UUID,
    "paid_from_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejected_reason" TEXT,
    "voucher_id" UUID,
    "reimburse_voucher_id" UUID,
    "recurring_id" UUID,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "net" DECIMAL(19,4) NOT NULL,
    "tax_code" TEXT,
    "paid_from_id" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "next_run_date" DATE NOT NULL,
    "end_date" DATE,
    "auto_post" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "expense_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" UUID,
    "manager_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "start_date" DATE,
    "end_date" DATE,
    "budget_revenue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "budget_cost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "due_date" DATE,
    "estimated_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "useful_life_months" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'SL',
    "asset_account_id" UUID,
    "accum_dep_account_id" UUID,
    "dep_expense_account_id" UUID,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "purchase_date" DATE NOT NULL,
    "cost" DECIMAL(19,4) NOT NULL,
    "salvage_value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'SL',
    "depreciation_start" DATE NOT NULL,
    "location" TEXT,
    "custodian_id" UUID,
    "supplier_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "purchase_voucher_id" UUID,
    "disposed_at" DATE,
    "disposal_proceeds" DECIMAL(19,4),
    "disposal_voucher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "voucher_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_location" TEXT,
    "to_location" TEXT,
    "from_custodian" UUID,
    "to_custodian" UUID,
    "note" TEXT,
    "created_by" UUID NOT NULL,

    CONSTRAINT "asset_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "performed_by" TEXT,
    "next_due_date" DATE,
    "voucher_id" UUID,
    "created_by" UUID NOT NULL,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_company_id_name_key" ON "lead_sources"("company_id", "name");

-- CreateIndex
CREATE INDEX "leads_company_id_stage_idx" ON "leads"("company_id", "stage");

-- CreateIndex
CREATE INDEX "contacts_company_id_party_id_idx" ON "contacts"("company_id", "party_id");

-- CreateIndex
CREATE INDEX "activities_company_id_lead_id_idx" ON "activities"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "activities_company_id_due_at_idx" ON "activities"("company_id", "due_at");

-- CreateIndex
CREATE INDEX "notifications_company_id_user_id_read_at_idx" ON "notifications"("company_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "departments_company_id_name_key" ON "departments"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "designations_company_id_name_key" ON "designations"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_code_key" ON "employees"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_company_id_name_key" ON "salary_components"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_items_employee_id_component_id_key" ON "employee_salary_items"("employee_id", "component_id");

-- CreateIndex
CREATE INDEX "attendance_company_id_date_idx" ON "attendance"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_company_id_name_key" ON "leave_types"("company_id", "name");

-- CreateIndex
CREATE INDEX "leave_requests_company_id_employee_id_idx" ON "leave_requests"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_documents_company_id_employee_id_idx" ON "employee_documents"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_company_id_period_key" ON "payroll_runs"("company_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_company_id_name_key" ON "expense_categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "expenses_company_id_status_idx" ON "expenses"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_company_id_number_key" ON "expenses"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_budgets_company_id_category_id_year_month_key" ON "expense_budgets"("company_id", "category_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "projects_company_id_code_key" ON "projects"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_tasks_company_id_project_id_idx" ON "project_tasks"("company_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_company_id_name_key" ON "asset_categories"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_company_id_code_key" ON "fixed_assets"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_asset_id_period_key" ON "asset_depreciations"("asset_id", "period");

-- CreateIndex
CREATE INDEX "asset_transfers_company_id_asset_id_idx" ON "asset_transfers"("company_id", "asset_id");

-- CreateIndex
CREATE INDEX "asset_maintenance_company_id_asset_id_idx" ON "asset_maintenance"("company_id", "asset_id");

-- AddForeignKey
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "salary_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE payslips ADD CONSTRAINT ps_net_check CHECK (net = gross - deductions);
ALTER TABLE expenses ADD CONSTRAINT ex_total_check CHECK (total = net + vat AND net >= 0);
ALTER TABLE fixed_assets ADD CONSTRAINT fa_cost_check CHECK (cost > 0 AND salvage_value >= 0 AND salvage_value < cost AND useful_life_months > 0);

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
