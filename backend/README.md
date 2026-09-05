# tuner backend

FastAPI service behind [Tuner](../README.md): it ingests documents, embeds
them, and runs the workflows that answer questions about them.

Two applications live here and share everything below the API:

- **`app/main.py`** — the editor. Uploads, embedding, model downloads, the
  workflow files, chat.
- **`app/serve.py`** — what a *deployed* workflow runs. Two routes, no
  database, its vectors carried in SQLite. See [Deploying](#deploying).

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
  main.py          the editor's FastAPI app, lifespan, /health
  serve.py         what a deployed image runs: /ask and /health
  config.py        settings, and BASE_DIR that paths resolve against
  sql/             every statement the app runs, one file each
  api/
    routes.py      the HTTP surface
    schemas.py     request and response bodies
  db/
    session.py     engine, session factory, get_session dependency
    sql.py         loads named statements from app/sql/
    models.py      schema of record, for `alembic check` only
  rag/
    native.py      chunking, embedding, retrieval, reranking
    workflow.py    compiles a .flow into a LangGraph graph and runs it
    chat.py        the prompt, the answer, and its citations
  services/
    hf_api.py      Hugging Face Hub client and the Inference API
    downloads.py   fetch a model, then record it
    storage.py     uploaded files on disk
    flows.py       workflows and .flow files on disk
    deploy.py      packaging a workflow as a Docker image
flows/<workflow>/  the workflows themselves, as plain JSON
exports/           Docker build contexts written by deploy
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

The name is declared in the file, by a `-- name:` line introducing each
statement, so a statement can move between files without touching the code that
asks for it:

```sql
-- name: job_progress
UPDATE download_jobs
SET downloaded_bytes = :downloaded_bytes,
    updated_at       = now()
WHERE id = :id;
```

The files are grouped the way the schema is: one per table for the writes
against it — `sources.sql`, `source_documents.sql`, `document_chunks.sql`,
`embedding_models.sql`, `download_jobs.sql` — so everything that can break a
table's invariants sits together, next to the constraints it has to respect.
Reads cannot break an invariant, so all of them share `queries.sql`. A duplicate
name across files is an error at load time, not a silent win for whichever file
sorted last.

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

**Models and downloads**

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/models?search=` | — | embedding models from the Hub, most downloaded first |
| GET | `/models/downloaded` | — | models already on disk, most recent first |
| POST | `/models/download` | `{model_id}` | `202` with the job to poll |
| GET | `/jobs` | — | recent download jobs, newest first |
| GET | `/jobs/{id}` | — | one job: status, bytes, error |

**Sources and documents**

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/sources` | — | every source, newest first |
| POST | `/embed` | multipart: `name`, `model`, `files`, optional `source_id`, `description` | the source, with its documents `queued` |
| POST | `/sources/{id}/embed` | — | re-runs the pipeline over that source's unembedded documents |
| POST | `/sources/merge` | `{source_ids, name, keep_originals}` | the merged source |
| DELETE | `/sources/{id}` | — | `{"ok": true}` |
| DELETE | `/sources/{id}/documents/{id}` | — | `{"ok": true}` |

**Workflows and flows**

A workflow is a directory of `.flow` files; `main.flow` is where a run starts.
Names are matched against a pattern rather than sanitised — they become paths,
and a rule about what a name *is* leaves no room for a `..` to survive some
cleaning step.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/workflows` | — | every workflow, alphabetically |
| POST | `/workflows` | `{name}` | `201` with the workflow, its `main.flow` ready |
| POST | `/workflows/{w}/rename` | `{name}` | the renamed workflow; its flows move with it |
| DELETE | `/workflows/{w}` | — | `{"ok": true}`; the last one is refused |
| GET | `/workflows/{w}/flows` | — | its `.flow` files, `main.flow` first |
| GET | `/workflows/{w}/flows/{name}` | — | one flow's graph |
| PUT | `/workflows/{w}/flows/{name}` | `{nodes, edges}` | writes it, creating the file if new |
| POST | `/workflows/{w}/flows/{name}/rename` | `{name}` | renames it, repointing the Agent widgets that call it |
| DELETE | `/workflows/{w}/flows/{name}` | — | `{"ok": true}`; `main.flow` is refused |
| POST | `/workflows/{w}/deploy?build=` | — | a Docker build context, and an image if a daemon answers |

**Chat**

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/chat/defaults` | — | the default system message and the chat model |
| POST | `/chat` | `{message, workflow, flow?, history?}` | the answer and the passages it rested on |

`POST /chat` runs the named workflow's `main.flow` — `flow` names another file
in it to try a sub-flow on its own. Setting `use_flow: false` falls back to
naming `source_ids` directly, which is the way in before any workflow exists.

Request bodies are snake_case, responses camelCase — matching what
`frontend/tuner/src/lib/api.ts` sends and the `Source` type it expects.

### Embedding

`POST /embed` answers as soon as the files are on disk and their rows exist,
then chunks and embeds them in the background — a document takes seconds to
minutes, far longer than a request should be held open. Documents walk
`queued → embedding → ready` (or `failed`) on their own rows, so a caller
polling `GET /sources` sees the run without the route returning anything about
it. `POST /sources/{id}/embed` picks up whatever a previous run did not finish.

A document that cannot be parsed is recorded as failed and the rest go on: one
corrupt PDF in an upload of fifty should not cost the other forty-nine.

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

## Errors

A failure the user can act on is said in their terms — which widget, which
source, which flow — rather than collapsed into a 500.

| | |
| --- | --- |
| `400` | a name that could not be a workflow or a flow; a chat with neither a workflow nor sources |
| `402` | the Hugging Face token is out of inference credit |
| `404` | unknown source, document, model, workflow or flow |
| `409` | a flow that cannot run as drawn; sources that disagree on a model; deleting `main.flow` or the last workflow |
| `415` | a file that is not `.pdf` or `.txt` |
| `422` | a body that does not validate — a dangling wire, a model id that is not `owner/name` |
| `502` | the Hub or the Inference API is unreachable |

## The pipeline

`app/rag/` is the whole of it. Everything runs on this machine except the
sentence that comes back: retrieval, reranking and embedding are local models
over the vectors in Postgres, and only the final generation is an API call.

**`native.py`** — the local half.

| | |
| --- | --- |
| `Chunking` | Splits a document into passages its model can take. A `Title` starts a new section and a passage never crosses one, because two sections either side of a boundary have nothing to do with each other and a vector covering both answers for neither. Sentences are kept whole; `OVERLAP_SENTENCES` repeats one across a cut. |
| `NativeRAG` | Embeds passages (mean-pooled, L2-normalised, so cosine is a dot product) and retrieves them. `similarity` takes the nearest; `mmr` discounts each candidate by how much it resembles what is already picked. |
| `Passages` | Where candidates are read from — Postgres here, a SQLite file inside a deployed image. Everything above it reads the same rows either way. |
| `Reranker` | A cross-encoder that reads question and passage together. Slow, so it only ever sees a shortlist retrieval produced. |

Scoring happens in Python rather than in the database: without pgvector there
is no cosine operator to order by and no index to serve it. That is a scan —
fine for a corpus that fits in memory, and the thing to replace with a `vector`
column when the extension is available. It is also what lets a deployed image
search a SQLite file with the same code.

Models are loaded once per id behind `NativeRAG.shared` and `Reranker.shared`,
because the weights are hundreds of megabytes and a question should not pay for
loading them.

**`workflow.py`** — compiles a `.flow` into a LangGraph `StateGraph`. Each
widget becomes a node and each wire an edge, so the graph that executes has the
same shape as the one drawn: widgets on separate branches run concurrently, a
widget with two inputs waits for both, an Agent widget runs another flow as a
subgraph, and a Router widget becomes a conditional edge so the branches not
chosen never run at all.

Only widgets with a path to the Output widget are compiled in. A widget wired
to nothing is one the user dropped and has not connected; running it would mean
a half-built flow behaved as though it were finished.

**`chat.py`** — assembles the prompt and turns the answer into citations. The
user's system message is sent first and unchanged, with the grounding rules —
answer only from these passages, cite every claim — appended rather than
wrapped around it.

## Workflows on disk

```
flows/
└── My workflow/          a workflow is a directory
    ├── main.flow         where a run of it starts
    └── triage.flow       reached from main.flow by an Agent widget
```

A `.flow` file is JSON: `{"nodes": [...], "edges": [...]}`. They are written
atomically — beside the target, then moved into place — so a crash part way
through leaves the previous flow intact rather than half a file that no longer
parses.

Flows written under an older widget vocabulary are upgraded as they are read
(`services/flows.py`, `upgrade`): `answer` became `output`, a `retrieval`
widget's budget moved onto the Source it fed, a single `sourceId` became a
list. The file itself is only rewritten when the user next saves it, and only
a flow that actually holds an old widget is touched.

## Deploying

`POST /workflows/{w}/deploy` writes a Docker build context to
`exports/<workflow>/` and builds it if a daemon answers. The image is
self-contained: the flows, the passages they retrieve from as SQLite, and the
embedding model that made them.

It runs `app/serve.py` — two routes, `POST /ask` and `GET /health` — with
`VECTOR_DB` set, which is what switches `Passages` off Postgres. Nothing else
changes: the same widgets, the same compiler, the same retrieval, so a deployed
answer and a local one come from one implementation rather than two that drift.

The vectors are a snapshot. Embedding more documents here does not change what
a built image answers from.

## Run

```bash
uvicorn app.main:app --reload
```

`GET /health` reports whether the process can reach Postgres. Startup only
warns when the database is down, so the Hugging Face routes stay workable
without it.
