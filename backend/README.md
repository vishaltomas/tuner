# tuner backend

FastAPI service for browsing Hugging Face embedding models and storing the
sources they are run against.

## Setup

```bash
uv pip install -e ".[dev]"
cp .env.example .env      # then fill in HUGGING_FACE_API_TOKEN
```

## Database

PostgreSQL, reached over `asyncpg`. Connection settings live in `.env` as
`DATABASE_URL`; nothing else hardcodes credentials.

Create the role and database once (needs cluster superuser access):

```bash
./scripts/init_db.sh
```

Then apply the schema, and re-apply after pulling any new migration:

```bash
alembic upgrade head
```

### Migrations

The schema is owned by Alembic — never edit tables by hand.

Every statement in this project lives in a `.sql` file. A revision under
`migrations/versions/` is only a two-line loader naming its files:

```
migrations/sql/0001_upgrade.sql      -- the DDL
migrations/sql/0001_downgrade.sql
migrations/versions/0001_*.py        -- op.execute(<file>.read_text())
```

```bash
alembic revision -m "what changed"    # then add the matching .sql pair
alembic upgrade head
alembic downgrade -1
alembic upgrade head --sql            # review DDL without applying
```

Migrations connect with sync `psycopg`, not `asyncpg`: a whole .sql file holds
several statements, and asyncpg sends statements as prepared statements, which
Postgres refuses for multi-command strings. `migrations/env.py` swaps the
driver in the URL; nothing else changes.

Hand-written SQL means `models.py` and the database can drift apart. `alembic
check` catches that — it compares the models against the live schema and fails
if they disagree, so run it after every revision:

```bash
alembic check
```

It only sees models that `migrations/env.py` imports, so a new model module has
to be imported there alongside `models`.

### Layout

- `db.py` — engine, session factory, and the `get_session` FastAPI dependency
  (commits when a route returns, rolls back if it raises).
- `models.py` — `Source` and `SourceDocument`, mirroring the frontend's types.
- `migrations/` — Alembic environment, revision loaders, and `sql/`.
- `scripts/init_db.sql` — role and database bootstrap, run by `init_db.sh`.

## Run

```bash
uvicorn main:app --reload
```

`GET /health` reports whether the process can reach Postgres. Startup only
warns when the database is down, so the Hugging Face routes stay workable
without it.
