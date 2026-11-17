# Deployment

1. Provision PostgreSQL 16. Run `backend/docker/init-roles.sql` (creates the restricted `nexerp_app` role), create the DB owned by an owner role.
2. Set env (see `backend/.env.example`): `DATABASE_URL` (restricted role), `DIRECT_DATABASE_URL` (owner, for migrations), `JWT_ACCESS_SECRET` (>=32 random chars, from a secrets manager), `CORS_ORIGINS`, `REQUIRE_EMAIL_VERIFICATION=true`. **Change the default role passwords.**
3. `npx prisma migrate deploy` then `node dist/main.js` (the Dockerfile does both).
4. `docker compose up --build` from the repo root (*untested - Docker was not available when this was written*).
5. Backups: schedule `pg_dump` (or managed snapshots) + restore drills; not yet automated.
6. Replace the stub `MailService` with SES/SMTP; put the API behind TLS.

Never run the API as a superuser or the table owner without `FORCE ROW LEVEL SECURITY` (already forced) - superusers bypass RLS.

## Web (Next.js)
`cd web && npm ci && npm run build && npm start`. Set `API_URL` (server-side) to the API base, e.g. `https://api.example.com/api/v1`. Serve it over HTTPS (cookies are `Secure` in production; set `COOKIE_SECURE=false` only for plain-http local runs). Put the web app and API behind one domain or reverse proxy.

## Mobile (Flutter)
`cd mobile && flutter pub get && flutter run --dart-define=API_URL=https://api.example.com/api/v1`. Android emulator default is `http://10.0.2.2:4100/api/v1`; iOS simulator: pass `--dart-define=API_URL=http://localhost:4100/api/v1`. Release builds need signing config (not included). **The app has been analysed and unit/widget-tested but not run on a device or simulator.**

## Scheduled jobs
Set `ENABLE_SCHEDULER=true` on exactly ONE API instance: after 02:00 UTC each day it runs recurring invoices, recurring expenses and CRM reminders for every active company (acting as that company's first administrator). The same endpoints can also be called from cron: `POST /sales/recurring/run`, `POST /expenses/recurring/run`, `POST /crm/reminders/run`.

## Backups
Create the backup role (`backend/docker/init-roles.sql`), then schedule `BACKUP_DATABASE_URL=... BACKUP_DIR=... ops/backup.sh` (verifies the archive, keeps `KEEP_DAYS`). Copy the folder off-site. Restore into an empty database with `TARGET_URL=... ops/restore.sh <dump>` as a superuser. Row level security is FORCEd, so the normal owner role cannot dump data - this is intentional.

## Email and files
`SMTP_URL` + `MAIL_FROM` enable real email. `STORAGE_DRIVER=s3` with `S3_BUCKET`/`S3_REGION` (and `S3_ENDPOINT` for S3-compatible services) stores attachments in object storage.
