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

Hand-written SQL means `app/db/models.py` and the database can drift apart. `alembic
check` catches that — it compares the models against the live schema and fails
if they disagree, so run it after every revision:

```bash
alembic check
```

It only sees models that `migrations/env.py` imports, so a new model module has
to be imported there alongside `app.db.models`.

## Layout

```
app/
  main.py          FastAPI app, lifespan, /health
  config.py        settings, and BASE_DIR that paths resolve against
  api/
    routes.py      the HTTP surface
    schemas.py     request and response bodies
  db/
    session.py     engine, session factory, get_session dependency
    models.py      Source and SourceDocument
  services/
    hf_api.py      Hugging Face Hub client
    storage.py     uploaded files on disk
migrations/        Alembic environment, revision loaders, and sql/
scripts/           init_db.sh and the init_db.sql it runs
```

Imports are absolute from `app`, and `.env` and `uploads/` are found relative to
the backend directory rather than the working directory — so commands behave the
same wherever they are run from.

## API

The frontend calls `/api/*`; Vite proxies that to this service with the prefix
stripped (see `frontend/tuner/vite.config.ts`), so requests arrive same-origin
and no CORS handling is needed. Serving the built frontend from another origin
would need `CORSMiddleware` added in `app/main.py`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/models?search=` | — | embedding models from the Hub, most downloaded first |
| GET | `/sources` | — | every source, newest first |
| POST | `/embed` | multipart: `name`, `model`, `files`, optional `source_id`, `description` | the created or updated source |
| POST | `/sources/merge` | `{source_ids, name, keep_originals}` | the merged source |
| DELETE | `/sources/{id}` | — | `{"ok": true}` |
| DELETE | `/sources/{id}/documents/{id}` | — | `{"ok": true}` |

Request bodies are snake_case, responses camelCase — matching what
`frontend/tuner/src/lib/api.ts` sends and the `Source` type it expects.

`POST /embed` stores the files and their rows, and leaves every document
`queued`. **Nothing embeds them yet** — no chunking, no vectors, no model
download. Statuses only move past `queued` once that pipeline exists.

Errors: `404` unknown source or document, `409` a model that disagrees with the
source's, `415` a file that is not `.pdf` or `.txt`, `502` the Hub is
unreachable.

## Run

```bash
uvicorn app.main:app --reload
```

`GET /health` reports whether the process can reach Postgres. Startup only
warns when the database is down, so the Hugging Face routes stay workable
without it.
