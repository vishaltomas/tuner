-- One-time bootstrap: the app role and its database.
--
-- Run through scripts/init_db.sh, which reads DATABASE_URL from .env and
-- passes the parts in, so no password is ever written to a tracked file:
--
--   psql -v db_user=... -v db_password=... -v db_name=... -f scripts/init_db.sql
--
-- Needs superuser access. Schema itself belongs to Alembic — this file only
-- creates the role and the empty database.

\set ON_ERROR_STOP on

-- CREATE ROLE and CREATE DATABASE cannot be parameterised, and CREATE DATABASE
-- cannot run inside a DO block, so each statement is built with format() and
-- run by \gexec. %I quotes identifiers, %L quotes the password literal.

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec

\connect :db_name

SELECT format('GRANT ALL ON SCHEMA public TO %I', :'db_user')
\gexec
