# NEXERP implementation checklist (status as of the last test run)

Legend: [x] done **and covered by an automated test** · [~] implemented, verified only manually / partly · [ ] not done.
A feature counts as done only when database + backend + client UI exist; client-UI tests are noted separately.

Test totals: backend **21 unit + 76 end-to-end** (real PostgreSQL), mobile **25** (unit + widget), web: production build + type-check + 3 util tests + a 10-check smoke test against the running servers + manual browser check.

## Environment used
macOS, Node 23, PostgreSQL 16, Flutter 3.41, Xcode 15.2. Docker and Redis are **not installed** here.

## Phase 1 - setup, auth, companies, tenant isolation
- [x] NestJS + Prisma + PostgreSQL, migrations, seed, Swagger
- [x] Company registration, company-code login, JWT + refresh rotation / reuse detection, lockout, rate limit
- [x] Email verification, forgot/reset password, invitations (mail transport is a stub - see assumptions)
- [x] Users, 8 default roles, custom roles, permission matrix (view/create/edit/delete/approve/post/cancel/export/print)
- [x] Company profile & settings, branches
- [x] Tenant isolation: PostgreSQL Row Level Security on every tenant table (also views), restricted runtime role
- [~] Company logo is a URL field (no image upload)
- [ ] Redis caching / queues (Redis not installed; nothing depends on it)

## Phase 2 - accounting engine
- [x] Central PostingService, financial years/periods, period locking (API + DB trigger), FX rates and translation
- [x] Chart of accounts (hierarchical groups), accounts, ledgers, statements, opening balances
- [x] Immutable journals / audit log (DB triggers), deferred balance trigger, reversal-only corrections

## Phase 3 - vouchers
- [x] 8 voucher types, numbering, workflow draft -> approval -> post -> cancel/replace, segregation of duties
- [x] Attachments (magic-byte checked, 10 MB, tenant scoped), print/PDF, notifications on submit
- [x] Attachment storage: local disk by default, S3-compatible driver (`STORAGE_DRIVER=s3`, unit-tested with a fake client; **not run against a real bucket**)

## Phase 4 - UAE VAT
- [x] Versioned tax codes (STD/ZERO/EXEMPT/OOS) with effective dates, inclusive/exclusive calculation, VAT ledger posting
- [x] Input/output VAT, credit/debit notes, adjustments, reversal of VAT, VAT 201-style return, VAT transaction report
- [~] Reverse charge, imports, tourist refunds, designated-zone boxes of the FTA return are not modelled

## Phase 5 - reports
- [x] All 16 mandatory reports (+ inventory, HR, CRM, project, asset, budget reports), filters, pagination, drill-down ids
- [x] Excel / PDF / CSV / print export; trial balance, balance sheet and cash flow reconcile in tests

## Phase 6 - sales & purchases
- [x] Customers/suppliers (own ledger accounts), quotation -> order -> invoice, credit/debit notes, receipts/payments with allocation, recurring invoices, credit limit
- [x] Purchase request -> PO -> GRN -> invoice, supplier statements, outstanding & ageing reports
- [~] Foreign-currency invoices cannot be settled through receipts/payments (use a voucher); no FX revaluation

## Phase 7 - inventory
- [x] Products, categories, units, warehouses, stock in/out, transfers, counts, batches/expiry, serials, barcode lookup, min stock
- [x] FIFO and weighted-average valuation, COGS, GRNI and price-variance postings, valuation reconciled to the ledger

## Phase 8-10 - CRM, HR/payroll/expenses, projects/assets
- [x] CRM: leads, sources, assignment, pipeline, conversion, contacts, activities, follow-up reminders, lead report
- [x] HR: departments, designations, employees, salary structures, attendance, leave (allowance/overlap), documents, payroll (approve/post/pay), employee & payroll reports
- [x] Expenses: categories, direct expenses + employee claims, approval (auto-posts), reimbursement, recurring, budgets
- [x] Projects: members, tasks, progress, income/cost/profitability from posted documents and expenses
- [x] Fixed assets: categories, register + purchase posting, SL/DB depreciation (idempotent), transfer, maintenance, disposal with gain/loss
- [x] Payroll pro-rata for employees who join or leave part-way through a month (tested)
- [~] Payroll: 30-day month for unpaid-day deductions, no WPS file, no end-of-service gratuity

## Dashboard & notifications
- [x] Live dashboard API (revenue, expenses, profit, cash, bank, AR, AP, VAT, inventory, trends, alerts) - ties to P&L in tests
- [x] In-app notifications (assignment, approvals, reminders). [ ] push notifications
- [x] Email: SMTP driver (`SMTP_URL`, unit-tested with nodemailer's JSON transport; **not sent through a real mail server**)
- [x] Nightly jobs (recurring invoices/expenses, CRM reminders) via `ENABLE_SCHEDULER=true` or `JobsService.runAll()`; tested end to end

## Web application (Next.js)
- [x] ~60 routes: auth, dashboard, accounting, VAT, sales, purchases, inventory, CRM, HR, projects, expenses, assets, reports, settings
- [x] Tokens in httpOnly cookies through a same-origin proxy; permission-aware navigation; production build passes
- [~] Verified manually in a browser for login, dashboard, voucher editor and ledger search; **not every screen was click-tested** and there are no automated UI (Playwright) tests

## Mobile (Flutter)
- [x] Login, dashboard, ledgers + statements, vouchers (list/detail/create payment, receipt, journal, approve/post/cancel), sales & purchase invoices, customers, suppliers, expenses, reports, approvals, notifications, profile
- [x] Offline drafts: stored on device, synced as DRAFTS only (never posted), server rejections kept with the reason
- [x] 25 automated tests, `flutter analyze` clean
- [ ] **Not run on a device/simulator.** `flutter build ios --simulator` was attempted twice and fails at link time with `Framework 'Flutter' not found` (engine artifacts are present; likely the installed Xcode 15.2 is too old for Flutter 3.41 - unconfirmed). The Android toolchain on this Mac is incomplete. Try a newer Xcode / `flutter doctor` fixes before shipping.

## Phase 12 - security & deployment
- [x] RLS, argon2id, JWT rotation, validation (whitelist), helmet, rate limiting, audit log, upload hardening
- [~] Dockerfile + docker-compose written but **never run** (Docker unavailable)
- [x] Backups: `ops/backup.sh` / `ops/restore.sh` with a dedicated BYPASSRLS role; a real dump was restored into a scratch database and row counts matched (scheduling and off-site copy are up to you)
- [x] `npm audit` (production deps): **0 vulnerabilities** in backend and web after dependency overrides (backend e2e + web build re-verified)
- [ ] External penetration test, secrets-manager integration, load testing
