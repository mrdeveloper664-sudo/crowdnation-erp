-- Creates the non-superuser application role used at runtime (Row Level Security is enforced for it).
CREATE ROLE nexerp_app LOGIN PASSWORD 'nexerp_app_pw' NOSUPERUSER NOBYPASSRLS;

-- Backups: row level security is FORCEd even for the owner, so a dump needs a role that may bypass it.
-- Use ONLY for ops/backup.sh; never for the application. Change the password.
CREATE ROLE nexerp_backup LOGIN PASSWORD 'nexerp_backup_pw' BYPASSRLS;
GRANT pg_read_all_data TO nexerp_backup;
