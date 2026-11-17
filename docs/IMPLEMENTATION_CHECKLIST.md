# NEXERP implementation checklist (status as of the last test run)

Legend: [x] done **and covered by an automated test** · [~] implemented, verified only manually / partly · [ ] not done.
A feature counts as done only when database + backend + client UI exist; client-UI tests are noted separately.

Test totals (last full run, all green): backend **24 unit + 92 end-to-end** (real PostgreSQL), web **8 Playwright browser tests** + production build + type-check + 3 util tests + a 10-check smoke test, mobile **25** (unit + widget, `flutter analyze` clean).

## Environments used
- Original development: macOS, Node 23, PostgreSQL 16, Flutter 3.41, Xcode 15.2 (no Docker/Redis).
- Cloud verification run (this update): Linux container, Node 22, PostgreSQL 16 (`ops/setup-dev-db.sh` creates the roles/databases), Flutter 3.41.9 (installed from storage.googleapis.com), Playwright/Chromium, Docker 29 (daemon started by hand). No Android SDK, no Xcode, Redis not used.

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
- [x] Reverse charge on purchases (opt-in `RC` code): supplier owed the net, input + output VAT posted together, VAT 201 boxes 3 and 10 and totals (8 e2e tests + 1 browser test)
- [~] Imports (boxes 6/7), tourist refunds (box 2) and designated-zone rules of the FTA return are not modelled; reverse charge is not available on sales documents or expenses (rejected on purpose)

## Phase 5 - reports
- [x] All 16 mandatory reports (+ inventory, HR, CRM, project, asset, budget reports), filters, pagination, drill-down ids
- [x] Excel / PDF / CSV / print export; trial balance, balance sheet and cash flow reconcile in tests

## Phase 6 - sales & purchases
- [x] Customers/suppliers (own ledger accounts), quotation -> order -> invoice, credit/debit notes, receipts/payments with allocation, recurring invoices, credit limit
- [x] Purchase request -> PO -> GRN -> invoice, supplier statements, outstanding & ageing reports
- [x] Foreign-currency invoices are settled through receipts/payments with realised FX gain/loss (`FX_GAIN`/`FX_LOSS`, posted only through `PostingService`, reversed on cancel; trial balance stays balanced; 8 e2e + 3 unit tests)
- [~] FX limits: settlement currency must equal the invoice currency, one settlement = one currency, credit/debit notes only apply at the same rate, foreign advances are not FX-adjusted when later allocated, **no period-end revaluation of open foreign balances (unrealised FX)**

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
- [x] Automated browser tests (Playwright, `cd web && npm run test:e2e`, real backend + built app): login (wrong password, httpOnly cookies, redirect), dashboard, journal voucher (unbalanced blocked, draft -> post, save & post), sales invoice create + post, reverse-charge purchase invoice + VAT 201 boxes, trial-balance report and PDF/Excel/CSV export, trial balance debit = credit
- [~] **Only those flows are browser-tested**: the other ~50 screens are covered by the smoke test (HTTP 200 + shell) and earlier manual checks, not clicked through automatically. Bugs found/fixed by this pass: report pages were titled just "Report", and the voucher editor rendered keyed rows inside unkeyed fragments

## Mobile (Flutter)
- [x] Login, dashboard, ledgers + statements, vouchers (list/detail/create payment, receipt, journal, approve/post/cancel), sales & purchase invoices, customers, suppliers, expenses, reports, approvals, notifications, profile
- [x] Offline drafts: stored on device, synced as DRAFTS only (never posted), server rejections kept with the reason
- [x] 25 automated tests, `flutter analyze` clean
- [ ] **Not run on a device/simulator. No Android SDK or Xcode exists in the cloud environment, so `flutter build apk --debug` was NOT attempted this time** (only `flutter analyze` and `flutter test` were re-run: clean / 25 pass). `flutter build ios --simulator` was attempted twice and fails at link time with `Framework 'Flutter' not found` (engine artifacts are present; likely the installed Xcode 15.2 is too old for Flutter 3.41 - unconfirmed). The Android toolchain on this Mac is incomplete. Try a newer Xcode / `flutter doctor` fixes before shipping.

## Crowd Nation company & GitHub Codespaces
- [x] `npm run db:seed:crowdnation` creates the company (idempotent, run twice locally: created, then "already exists"); no password in the repo
- [ ] `.devcontainer/` (Codespaces: Postgres + migrate + seed + start servers) is written but **never run** - Codespaces/dev containers are not available from the cloud session that wrote it

## Phase 12 - security & deployment
- [x] RLS, argon2id, JWT rotation, validation (whitelist), helmet, rate limiting, audit log, upload hardening
- [~] Docker: `docker compose` (postgres + backend) was run once in a sandbox: image built, all 9 migrations applied, API started, `/api/docs` answered 200, company registration + login worked, runtime role is `nexerp_app` (not superuser, no BYPASSRLS). **Caveats:** the sandbox blocks `deb.debian.org`, so the image was built from a copy of the Dockerfile on `node:22-bookworm` without the `apt-get install openssl` step (the committed Dockerfile's apt step was *not* executed); the web app has no Dockerfile/compose service; Redis is started but unused. Added `backend/.dockerignore` (host `node_modules` were being copied into the image) and configurable host ports.
- [x] Backups: `ops/backup.sh` / `ops/restore.sh` with a dedicated BYPASSRLS role; a real dump was restored into a scratch database and row counts matched (scheduling and off-site copy are up to you)
- [x] `npm audit` (production deps): **0 vulnerabilities** in backend and web after dependency overrides (backend e2e + web build re-verified)
- [ ] External penetration test, secrets-manager integration, load testing
