# Security notes

## Implemented
- **Tenant isolation** at the database: Row Level Security (`FORCE`d) on every table that has `company_id`, policy bound to a transaction-local setting. The API connects as a non-superuser role. Tests prove cross-tenant reads/writes fail even with raw SQL.
- **Authentication**: argon2id; 15-minute access JWT (HS256, pinned algorithm); opaque refresh tokens stored hashed, rotated on use, whole family revoked on reuse; lockout after 5 failures (15 min); generic login errors; password reset invalidates sessions; per-IP rate limits on credential endpoints (`AUTH_RATE_LIMIT`).
- **Authorization**: `resource:action` permissions enforced by a guard on every route; segregation of duties on vouchers, expenses and payroll.
- **Accounting integrity**: balanced-journal trigger, immutable journal/audit tables (UPDATE/DELETE also revoked), period-lock trigger, idempotent posting.
- **Input**: global whitelist validation (unknown fields rejected), money only as decimal strings, UUID pipes, parameterised SQL (`$queryRaw` tagged templates).
- **Uploads**: 10 MB limit, extension allow-list **and magic-byte check** (declared type never trusted), random storage keys, path-traversal guard, `nosniff` + attachment disposition.
- **Web**: tokens only in httpOnly cookies behind a same-origin proxy (no tokens in JS), security headers, public auth proxy allow-list.
- **Mobile**: tokens in Keychain/Keystore (`flutter_secure_storage`).

## Dependency audit
`npm audit --omit=dev` reports 0 vulnerabilities for backend and web. Three transitive advisories were cleared with `overrides` (`deepmerge-ts` ^8, `uuid` ^11.1.1 in the backend; `postcss` ^8.5.10 in the web); the full backend end-to-end suite and the web production build were re-run afterwards. Re-run the audit regularly - overrides need review when Prisma/exceljs/Next are upgraded.

## Known gaps / to do before production
1. No external penetration test, no SAST in CI, no dependency-update automation.
2. SMTP and S3 drivers exist but were only tested with fakes; enforce `REQUIRE_EMAIL_VERIFICATION=true` once email works.
3. Move secrets to a secrets manager; rotate the default dev DB passwords (including `nexerp_backup`); terminate TLS in front of the API.
4. Add virus scanning for uploads; add CSRF defence if cookies are ever used cross-site (currently SameSite=Lax + same-origin proxy).
5. Backups are scripted (`ops/backup.sh`) but not scheduled or shipped off-site; run a restore drill regularly.
6. Add refresh-token / session listing and device revocation UI.
