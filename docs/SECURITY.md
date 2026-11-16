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

## Known gaps / to do before production
1. `npm audit` (prod deps) reports: `deepmerge-ts` via Prisma tooling (stack exhaustion on attacker-controlled recursive objects - config tooling only), `uuid` via `exceljs` (buffer bounds, not reachable: we never pass a buffer), and `postcss` bundled in Next 15 (build-time CSS only). Upgrade Next/Prisma/exceljs when compatible versions are verified; I did not force-upgrade breaking majors.
2. No external penetration test, no dependency pinning policy, no SAST in CI.
3. Replace the stub mail service; enforce `REQUIRE_EMAIL_VERIFICATION=true`.
4. Move secrets to a secrets manager; rotate the default dev DB passwords; terminate TLS in front of the API.
5. Add S3-compatible storage + virus scanning for uploads; add CSRF defence if cookies are ever used cross-site (currently SameSite=Lax + same-origin proxy).
6. Automated encrypted backups and restore drills.
7. Add refresh-token / session listing and device revocation UI.
