# Database design (Phases 1-3)

PostgreSQL 16, Prisma schema in `backend/prisma/schema.prisma`; hand-written integrity SQL in `backend/prisma/migrations/*_rls_and_integrity`.

- **Tenancy**: every table except `companies` and `permissions` has `company_id` and an RLS policy
  `company_id = current_setting('app.current_company_id')::uuid`, `FORCE`d. `PrismaService.tenant(companyId, fn)` opens a transaction and sets the variable with `set_config(..., true)` (transaction-local). Without it, queries return zero rows and inserts fail.
- **Tables**: companies, company_settings, branches, users, roles, permissions, user_roles, role_permissions, refresh_tokens, email_tokens, invitations, financial_years, accounting_periods, exchange_rates, account_groups, accounts, ledger_opening_balances, document_sequences, journal_entries, journal_entry_lines, vouchers, voucher_lines, attachments, audit_logs.
- **Money**: `NUMERIC(19,4)`; exchange rates `NUMERIC(19,8)`. No floating-point columns.
- **Added in later phases**: tax_rates, tax_transactions, parties, documents, document_lines, settlements, settlement_allocations, recurring_invoices, product_categories, units_of_measure, warehouses, products, stock_movements, stock_layers (FIFO), stock_serials, leads, lead_sources, contacts, activities, notifications, departments, designations, employees, salary_components, employee_salary_items, attendance, leave_types, leave_requests, employee_documents, payroll_runs, payslips, expense_categories, expenses, recurring_expenses, expense_budgets, projects, project_members, project_tasks, asset_categories, fixed_assets, asset_depreciations, asset_transfers, asset_maintenance.
- **Specified table names that are views**: `customers`, `suppliers` (over `parties`), `sales_invoices`, `purchase_invoices` (over `documents`), `receipts`, `payments` (over `settlements`). Views use `security_invoker`, so tenant RLS applies.
- **Fresh install**: every migration is replayed from empty (verified on a scratch database).
- Regenerate/apply: `npx prisma migrate dev` (dev) · `npx prisma migrate deploy` (CI/prod).
