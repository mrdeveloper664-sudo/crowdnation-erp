-- Creates the non-superuser application role used at runtime (Row Level Security is enforced for it).
CREATE ROLE nexerp_app LOGIN PASSWORD 'nexerp_app_pw' NOSUPERUSER NOBYPASSRLS;
