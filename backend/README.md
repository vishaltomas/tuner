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
  sql/             every statement the app runs, one file each
  api/
    routes.py      the HTTP surface
    schemas.py     request and response bodies
  db/
    session.py     engine, session factory, get_session dependency
    sql.py         loads app/sql/<name>.sql
    models.py      schema of record, for `alembic check` only
  services/
    hf_api.py      Hugging Face Hub client
    downloads.py   fetch a model, then record it
    storage.py     uploaded files on disk
migrations/        Alembic environment, revision loaders, and sql/
scripts/           init_db.sh and the init_db.sql it runs
```

Imports are absolute from `app`, and `.env` and `uploads/` are found relative to
the backend directory rather than the working directory — so commands behave the
same wherever they are run from.

## SQL

Every statement lives in a `.sql` file — schema in `migrations/sql/`, queries in
`app/sql/` — and no Python file contains SQL text. `app/db/sql.py` loads a
statement by name:

```python
await session.execute(sql("job_progress"), {"id": job_id, "downloaded_bytes": size})
```

Two rules the files follow, both enforced by how they are loaded:

- Values are **named parameters** (`:id`), bound by the driver, never
  interpolated into the string.
- Casts are written `CAST(:x AS document_kind)`, because the `::` form collides
  with the `:name` parameter syntax.

`app/db/models.py` still declares the tables, but nothing queries through it.
It exists so `alembic check` can compare the mapped metadata against the live
database — that comparison is what stops a hand-written migration from drifting
from the schema it claims to produce. A new table means writing the migration
SQL *and* the model.

## API

The frontend calls `/api/*`; Vite proxies that to this service with the prefix
stripped (see `frontend/tuner/vite.config.ts`), so requests arrive same-origin
and no CORS handling is needed. Serving the built frontend from another origin
would need `CORSMiddleware` added in `app/main.py`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/models?search=` | — | embedding models from the Hub, most downloaded first |
| GET | `/models/downloaded` | — | models already on disk, most recent first |
| POST | `/models/download` | `{model_id}` | `202` with the job to poll |
| GET | `/jobs` | — | recent download jobs, newest first |
| GET | `/jobs/{id}` | — | one job: status, bytes, error |
| GET | `/sources` | — | every source, newest first |
| POST | `/embed` | multipart: `name`, `model`, `files`, optional `source_id`, `description` | the created or updated source |
| POST | `/sources/merge` | `{source_ids, name, keep_originals}` | the merged source |
| DELETE | `/sources/{id}` | — | `{"ok": true}` |
| DELETE | `/sources/{id}/documents/{id}` | — | `{"ok": true}` |

Request bodies are snake_case, responses camelCase — matching what
`frontend/tuner/src/lib/api.ts` sends and the `Source` type it expects.

`POST /embed` stores the files and their rows, and leaves every document
`queued`. **Nothing embeds them yet** — no chunking, no vectors, and no model
is loaded, even one already downloaded. Statuses only move past `queued`
once that pipeline exists.

### Downloads

`POST /models/download` answers `202` with a job row and fetches the repo into
`models/<owner>/<name>` in the background, because a real embedding model is
hundreds of megabytes. Callers poll `GET /jobs/{id}` until `status` is
`succeeded` or `failed`.

While a download runs, a poller in the worker measures the snapshot directory
every second and writes `downloaded_bytes` to the job, against a `total_bytes`
read from the Hub — that is the only progress the Hub client offers. The
measured size includes the client's own cache, so it is clamped to the total
and finishes at exactly 100%; the true on-disk figure is kept separately as
`embedding_models.size_bytes`.

Because the work is detached, a download that cannot even start — no such
model, Hub unreachable — reports itself as a `failed` job with the reason in
`error`, rather than as an error from the POST. Asking for a model that is
already downloading returns the job already in flight instead of starting a
second one.

### The model catalogue

`sources.model` is a foreign key to `embedding_models.id`, so every source
points at a catalogue row. A model does not have to be downloaded to be used:
`POST /embed` registers the id first, leaving `local_path`, `size_bytes` and
`downloaded_at` null until a download fills them in. `GET /models/downloaded`
filters to the rows that have. The key is `ON DELETE RESTRICT` — a model still
named by a source cannot be deleted out from under it.

Errors: `404` unknown source, document, or model; `409` a model that
disagrees with the source's; `415` a file that is not `.pdf` or `.txt`;
`422` a model id that is not `owner/name`; `502` the Hub is unreachable.

## Run

```bash
uvicorn app.main:app --reload
```

`GET /health` reports whether the process can reach Postgres. Startup only
warns when the database is down, so the Hugging Face routes stay workable
without it.
