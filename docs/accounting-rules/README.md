# Accounting rules and assumptions

## Rules enforced by the engine (and where)
| Rule | Application | Database |
|---|---|---|
| Debit = credit on every journal | `PostingService.post` | deferred constraint trigger `trg_journal_balanced` (checked at COMMIT) |
| One-sided, positive lines | `PostingService`, DTO validation | CHECK `jel_one_sided`, `jel_non_negative`, `jel_has_amount` |
| Posted journals immutable | no update/delete code paths | triggers `trg_je_immutable`, `trg_jel_immutable`; UPDATE/DELETE revoked from app role |
| Corrections by reversal | `PostingService.reverse` (mirror entry) | unique `reversal_of_id` prevents double reversal |
| No duplicate posting | idempotency key per source | unique `(company_id, idempotency_key)` |
| Period locking | `PeriodService.requireOpenPeriod` | trigger `trg_je_period` |
| Atomic posting | everything inside one DB transaction | - |
| Money precision | `Prisma.Decimal` / decimal strings in the API, never JS numbers | `NUMERIC(19,4)` |
| Audit trail | `AuditService` on every financial/admin action | `audit_logs` is append-only (trigger) |
| Tenant isolation | `PrismaService.tenant()` sets `app.current_company_id` per transaction | Row Level Security `tenant_isolation` policy on every tenant table, `FORCE`d |

## Documented assumptions
1. **Accounts vs ledgers.** The brief lists both `accounts` and `ledgers` tables. A ledger is a postable account (Tally terminology), so there is one `accounts` table; the `/ledgers` API is the ledger view (balances, statements, opening balances). `ledger_opening_balances` exists as specified.
2. **Opening balances** are stored per financial year and then *posted* as one balanced `OPENING_BALANCE` journal dated the first day of the year. Any imbalance is parked in the system account "Opening Balance Difference" (3003) and reported. Reports therefore need only journal lines.
3. **Amount precision**: amounts carry at most `amountDecimals` (default 2) decimals; storage is 4 dp. Foreign amounts are translated line by line and rounded; up to 0.01 per line of translation difference is booked to "Rounding Differences" (5206). Realised FX gains/losses on settlements are implemented (assumption 18); *unrealised* FX revaluation of open foreign balances is **not** implemented yet.
4. **Voucher numbers** are allocated when the draft is created (like Tally), so deleting a draft leaves a gap. Journal entry numbers (`JE-<year>-nnnnnn`) are allocated at posting and are gap-free.
5. **Voucher cancellation** of a posted voucher posts a reversal dated today (or a supplied date, never earlier than the original). The voucher record stays, status CANCELLED, with links to both journals.
6. **Sales/Purchase/Credit/Debit note vouchers** currently accept generic balanced lines; invoice-driven postings with VAT arrive in Phases 4 and 6.
7. **Email** is a development stub (`MailService`): messages are logged/kept in memory. Plug in SES/SMTP before production. Email verification is recorded but only enforced when `REQUIRE_EMAIL_VERIFICATION=true`.
8. **Login identity** is (company code, email, password); the same email may exist in different companies.
9. **Dev database roles**: `nexerp` (owner, runs migrations) and `nexerp_app` (restricted runtime role). The migration grants to `nexerp_app` only if that role exists.

## Assumptions added in Phases 4-10
10. **VAT on vouchers**: VAT is tagged on the *VAT ledger line* of a voucher (`taxRateId` + `taxableAmount`). Sales/purchase documents, expenses and payroll-independent journals all go through this path, so `tax_transactions` always mirror the posted journal. Zero-rated/exempt supplies are tag-only lines (no amount). Tolerance between the entered VAT and rate x base is 0.05 (or 0.005 per line for large documents) to absorb line rounding.
11. **Credit/debit notes** reduce output/input VAT (negative `tax_transactions`); cancelling a posted voucher mirrors its tax rows.
12. **Inventory** is valued per movement at base-currency cost rounded to the amount decimals; weighted average uses on-hand value / quantity per product and warehouse, FIFO consumes layers in receipt order. GRN posts Dr Inventory / Cr "Goods Received Not Invoiced"; the supplier invoice clears GRNI and any difference goes to "Purchase Price Variance" (stock cost is not re-valued). Negative stock is not allowed.
13. **Payroll** uses a 30-day month for unpaid-day deductions; allowances/deductions come from the employee's salary structure. Posting: Dr Payroll Expense (gross) / Cr Salaries Payable (net) / Cr Employee Deductions Payable.
14. **Expenses**: approving posts automatically - direct expenses as a payment voucher (Dr expense + input VAT / Cr cash-bank), employee claims as a journal to "Employee Expense Claims Payable" until reimbursed.
15. **Fixed assets**: monthly depreciation (straight line or double-declining balance, never below salvage) posts one journal per run and is idempotent per asset+period; disposal requires depreciation up to the previous month and books the gain/loss.
16. **System accounts** needed by the engine (COGS, GRNI, price variance, payroll, claims, disposal gain/loss ...) are created on demand for existing companies.
17. **Reports** are computed live from journal lines, documents and movements; nothing is a stored total. The dashboard reconciles to the P&L for the same period (tested).

## Assumptions added with FX settlement and reverse charge
18. **Foreign-currency settlement.** A receipt/payment may carry `currency` + `exchangeRate` (default: latest saved rate). The voucher values the whole settlement at the settlement rate; each allocation additionally records the base-currency *carrying value* it clears from the party ledger (`settlement_allocations.base_amount` = amount x invoice rate; the allocation that exhausts the invoice clears the exact remaining base value, so rounding never leaves a residue). The difference between the settlement-rate value and the carrying value is the **realised FX gain/loss**, posted as a separate `SYSTEM` journal entry through `PostingService` (Dr party / Cr `FX_GAIN`, or Dr `FX_LOSS` / Cr party) and reversed when the settlement is cancelled. Limits: allocations must be in the settlement currency (an AED receipt cannot settle a USD invoice and vice versa); one settlement cannot mix currencies; a foreign receipt without allocations is an advance booked at its own rate (no FX until it is allocated by a later feature); credit/debit notes can only be applied to an invoice of the same currency *and* rate; there is no period-end revaluation of open foreign balances.
19. **Reverse charge (UAE VAT).** Opt-in tax code with `isReverseCharge` (create with `POST /vat/rates/reverse-charge` -> code `RC`, 5 %). On a purchase invoice/debit note the supplier is owed the *net* only (header VAT and total exclude the self-assessed VAT; each line still shows its VAT); posting adds a VAT-input debit and an equal VAT-output credit tagged with the RC code, so `tax_transactions` contain both rows. `VatService.vatReturn` reports them in box 3 (output) and box 10 (input) and in the box 8/11 totals; they are excluded from boxes 1a-1g and 9. Voucher validation requires equal input and output reverse-charge VAT per code and allows it on PURCHASE, DEBIT_NOTE and JOURNAL vouchers only. Rejected on sales documents, VAT-inclusive prices and expenses. Boxes 2 (tourist refunds), 6/7 (imports, designated zones) are still not modelled.
