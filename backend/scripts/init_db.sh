#!/usr/bin/env bash
# Create the app role and database by running scripts/init_db.sql.
#
#   ./scripts/init_db.sh
#
# Credentials are read from DATABASE_URL in .env and handed to psql as
# variables, so the password never lands in a tracked file. Needs superuser
# access to the cluster (sudo, or PGUSER/PGPASSWORD pointing at a superuser).
#
# Schema belongs to Alembic: after this, run `alembic upgrade head`.
set -euo pipefail

cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo "no .env in $(pwd)" >&2; exit 1; }

url=$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)
[[ -n "$url" ]] || { echo "DATABASE_URL not set in .env" >&2; exit 1; }

# postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DBNAME
creds=${url#*://}
userpass=${creds%%@*}
db=${creds##*/}
user=${userpass%%:*}
password=${userpass#*:}

# Fed over stdin rather than `-f`: psql then runs as postgres while the file
# is read by you, which matters on /mnt/c where postgres cannot always traverse.
sudo -u postgres psql \
    -v ON_ERROR_STOP=1 \
    -v db_user="$user" \
    -v db_password="$password" \
    -v db_name="$db" \
    -d postgres \
    < scripts/init_db.sql

echo "role '$user' and database '$db' ready; now run: alembic upgrade head"
