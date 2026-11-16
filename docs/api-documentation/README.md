# API reference (v1)

Base URL `http://localhost:4000/api/v1` · interactive Swagger UI at `/api/docs`.
Success: `{ "success": true, "data": ..., "meta"?: {page,pageSize,total,totalPages} }`
Error: `{ "success": false, "error": { "code", "message", "details"? }, "path", "timestamp" }`
Money is always a **decimal string** (`"1250.50"`). Dates are `YYYY-MM-DD`. Send `Authorization: Bearer <accessToken>`.

| Area | Endpoints |
|---|---|
| Auth (public) | `POST /auth/register-company` `login` `refresh` `logout` `verify-email` `forgot-password` `reset-password` `accept-invite` · `POST /auth/change-password` · `GET /auth/me` |
| Company | `GET/PATCH /company` · `GET/PATCH /company/settings` · `GET/POST /branches` `PATCH/DELETE /branches/:id` |
| Users & roles | `GET /users` · `POST /users/invitations` · `PATCH /users/:id` · `GET /permissions` · `GET/POST /roles` `PATCH/DELETE /roles/:id` |
| Accounting setup | `GET/POST /accounting/financial-years` · `POST /accounting/periods/:id/lock|unlock` · `GET/PUT /accounting/exchange-rates` |
| Chart of accounts | `GET/POST /chart-of-accounts/groups` `PATCH .../groups/:id` · `GET/POST /chart-of-accounts/accounts` `PATCH/DELETE .../accounts/:id` `POST .../accounts/:id/activate|deactivate` |
| Ledgers | `GET /ledgers` (balances) · `GET /ledgers/:id` · `GET /ledgers/:id/statement?from&to&search&page&pageSize` · `GET/PUT /ledgers/opening-balances` · `POST /ledgers/opening-balances/post` |
| Vouchers | `GET /vouchers?type&status&from&to&search&page` · `POST /vouchers` · `GET/PUT/DELETE /vouchers/:id` · `POST /vouchers/:id/submit|approve|reject|post|cancel|replace` |
| Reports | `GET /reports/catalog` · `GET /reports/run/:name?...&format=json|xlsx|pdf|csv|html` (names in the catalog: trial-balance, profit-and-loss, balance-sheet, cash-flow, general-ledger, day-book, cash-book, bank-book, ledger-statement, customer/supplier-outstanding, accounts-receivable/payable, vat, income/expense-report, stock-*, lead-report, employee-report, payroll-report, expense-budget, project-profitability, asset-register, depreciation-schedule) · `GET /reports/trial-balance` (legacy shape) |
| Dashboard | `GET /dashboard?financialYearId&from&to` |
| Journal | `GET /journal-entries/:id` (drill-down target) |
| VAT | `GET/POST /vat/rates` `PATCH /vat/rates/:id` · `POST /vat/calculate` · `GET /vat/transactions` · `GET /vat/return?from&to` |
| Customers / suppliers | `GET/POST /customers` `/suppliers` · `GET/PATCH /customers/:id` · `GET /customers/:id/statement` |
| Sales | `/sales/documents` (list/create/get/put/delete, `:id/confirm|convert|post|cancel|apply|print`) · `/sales/receipts` (+`:id/cancel`) · `/sales/recurring` (+`run`) |
| Purchases | `/purchases/documents` (same actions) · `/purchases/payments` |
| Inventory | `/inventory/categories|units|warehouses|products` (+`products/by-barcode/:code`) · `POST /inventory/stock-in|stock-out|transfers|adjustments` · `GET /inventory/stock|movements|serials` |
| CRM | `/crm/sources` `/crm/leads` (+`assign|stage|convert`) `/crm/pipeline` `/crm/contacts` `/crm/activities` `POST /crm/reminders/run` |
| HR | `/hr/departments|designations|salary-components|leave-types|employees` · `PUT /hr/attendance` · `/hr/leave` (+`approve|reject|cancel`, `balance/:employeeId`) · `/hr/payroll` (`generate`, `:id/approve|post|pay|cancel`) |
| Expenses | `/expenses` (+`:id/submit|approve|reject|reimburse|cancel`) `/expenses/categories` `/expenses/recurring` `/expenses/budgets` |
| Projects | `/projects` `/projects/:id/tasks` `/projects/:id/members` `PATCH /projects/tasks/:taskId` |
| Assets | `/assets` `/assets/categories` `POST /assets/depreciation/run` `POST /assets/:id/transfer|maintenance|dispose` |
| Attachments | `POST /attachments?entityType&entityId` (multipart `file`) · `GET /attachments` · `GET /attachments/:id/download` · `DELETE /attachments/:id` |
| Notifications | `GET /notifications` · `POST /notifications/read-all` · `POST /notifications/:id/read` |
| Audit | `GET /audit-logs?entityType&entityId&action&page` |
| Print / PDF | `GET /vouchers/:id/print`, `/sales/documents/:id/print`, `/purchases/documents/:id/print` (`?format=pdf`) |

Permissions are `resource:action` (e.g. `voucher:post`); each endpoint's required permission is declared in its controller (`@RequirePermission`).
