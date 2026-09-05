# Tuner

A workbench for retrieval-augmented generation you can see. Upload documents,
embed them locally, then **draw** the pipeline that answers questions about
them — sources, retrieval, reranking, routing — and deploy that drawing as a
Docker image.

The drawing is not a diagram of the system. It **is** the system: each widget
compiles to a node in a LangGraph graph, and the graph that runs has the same
shape as the one on screen.

```
Input(chat) ─▶ Embed ─▶ Source ─▶ Reranker ─▶ Output(chat)
                          ▲                       ▲
                     System message ──────────────┘
```

---

## What it does

**Embed Documents** — upload PDFs and text files against a Hugging Face
embedding model. They are parsed, split into passages that fit the model's
context, embedded, and stored. Chunking respects section boundaries, so a
passage never runs from the end of one topic into the start of the next.

**Workflow** — a full-screen canvas at `#/workflow`. A *workflow* is a
directory of `.flow` files; `main.flow` is where a run starts, and an Agent
widget inside it can call a sibling flow as a subgraph.

**Chat** — pick a workflow by name and ask it something. Answers are written
only from the retrieved passages, and every claim is cited back to the document
and page it came from. The passages that were retrieved are always shown, cited
or not — retrieval is the part of a RAG pipeline that quietly goes wrong, and
this is the only place it is visible.

**Deploy** — package a workflow as a self-contained Docker image: its flows,
its passages, and the embedding model that made them. The image needs no
database.

---

## The widgets

| Widget | What it does | Properties |
| --- | --- | --- |
| **Input** | Where a run starts | Chat, or a typed payload (`.txt .md .json .csv .html`) |
| **Source** | Where the answer comes from | Type (files / text / chat); for files: the sources, retrieval method, number of documents |
| **Embed** | Turns the question into a vector | Embedding model — blank uses whatever its sources were embedded with |
| **Reranker** | Reorders passages with a cross-encoder | Model, and how many to keep |
| **Router** | Sends the run down **one** branch; the rest are skipped | The routes, and the model that decides |
| **Agent** | Runs another flow, hands back its answer | Which `.flow` to run |
| **System message** | Standing instructions | The text |
| **Output** | Where a run ends | Chat, or a typed payload |

A widget wired to nothing is ignored — it renders faded and marked *not
connected*, so a half-built flow cannot quietly behave as though it were
finished. In `main.flow` the Input and Output widgets are always the chat,
since that is what Chat runs.

**Retrieval methods.** *Similarity* takes the passages closest to the question.
*MMR* picks each next passage for how relevant it is minus how much it resembles
what has already been picked, so a repetitive corpus does not fill the budget
with near-copies.

**Why a reranker.** Retrieval scores a passage without ever seeing the question
beside it — the two are embedded separately and compared as vectors, which is
fast enough to scan a corpus but blunt. A cross-encoder reads the question and
the passage *together*, which is far better at ranking and far too slow to run
over anything but a shortlist. So retrieval narrows, and the reranker reorders.

---

## Getting started

**You need** Python 3.12, Node 20+, PostgreSQL, and a Hugging Face token.

```bash
# backend
cd backend
uv pip install -e ".[dev]"       # or: pip install -e ".[dev]"
cp .env.example .env             # fill in HUGGING_FACE_API_TOKEN
./scripts/init_db.sh             # creates the role and database
alembic upgrade head             # applies the schema
uvicorn app.main:app --reload    # http://127.0.0.1:8000
```

```bash
# frontend, in another terminal
cd frontend/tuner
npm install
npm run dev                      # http://localhost:5173
```

Vite proxies `/api/*` to the backend with the prefix stripped, so requests
arrive same-origin and no CORS handling is needed.

**First run.** Download an embedding model in **Model Catalog**, upload
documents in **Embed Documents**, then open **Workflow** — a starter
`main.flow` is created for you with its two ends already wired.

> The first request after startup loads torch, transformers and the embedding
> weights. That import is warmed in the background as the server starts, so the
> server answers immediately and the first question does not pay for it.

---

## Deploying a workflow

Press **Deploy** in the workflow toolbar. It writes a Docker build context to
`backend/exports/<workflow>/` and, if a Docker daemon is reachable, builds it.

```
Dockerfile         python:3.12-slim, healthcheck, entrypoint
app/               the same widgets, compiler and retrieval this app runs
flows/             the workflow's .flow files
vectors.db         its passages and embeddings, as SQLite
models/            the embedding model, when it is downloaded locally
```

```bash
cd backend/exports/my-workflow
docker build -t tuner-my-workflow:latest .
docker run --rm -p 8080:8080 -e HUGGING_FACE_API_TOKEN=hf_... tuner-my-workflow:latest

curl -s localhost:8080/ask -H 'Content-Type: application/json' \
  -d '{"message": "your question"}'
```

The image serves two routes — `POST /ask` and `GET /health` — and carries its
vectors in SQLite rather than reaching for Postgres. It runs the *same* code
this app does, so a deployed answer and a local one come from one
implementation rather than two that drift.

**The vectors are a snapshot.** Embedding more documents here does not change
what a built image answers from; deploy again to pick them up.

---

## How it fits together

```
frontend/tuner/           React + MUI + React Flow
  src/sections/workflow/  the canvas, widget registry, inspector
  src/sections/chat/      the conversation and its citations
  src/sections/embed/     upload and embedding
  tests/                  unit assertions + Playwright suites

backend/
  app/main.py             the editor's API
  app/serve.py            what a deployed image runs
  app/rag/
    native.py             chunking, embedding, retrieval, reranking
    workflow.py           compiles a .flow into a LangGraph graph
    chat.py               the prompt, the answer, the citations
  app/services/
    flows.py              workflows and .flow files on disk
    deploy.py             packaging a workflow as an image
  app/sql/                every statement the app runs
  flows/<workflow>/       your workflows — plain JSON, diffable
```

Two conventions worth knowing before changing anything:

**Every SQL statement lives in a `.sql` file**, loaded by name — no Python file
contains SQL text. The schema is owned by Alembic, and `alembic check` fails if
the models and the live database disagree. See
[backend/README.md](backend/README.md).

**Widgets are declared once.** `frontend/tuner/src/sections/workflow/widgets.ts`
is the only place that knows what a widget *is*; the palette, canvas, inspector
and validator all read it. Adding one is an entry there, an icon, a `WidgetKind`
member, and a node function in `app/rag/workflow.py`.

---

## Testing

```bash
cd frontend/tuner
npm run test:unit    # graph resolution and wiring rules — no browser
npm run test:ui      # Playwright, against a running app
npm test             # both
```

`test:unit` covers what a flow means: which widgets are reachable, what makes a
flow incomplete, which wires are legal. `test:ui` drives the real page —
drag-and-drop, wiring, the toolbar, deployment, chat.

The UI suites need both servers running. Most stub the backend; the toolbar,
deploy and chat suites run against it for real and clean up after themselves.

---

## Configuration

All backend settings live in `backend/.env` (see `.env.example`). The ones
worth knowing:

| Setting | Default | What it does |
| --- | --- | --- |
| `HUGGING_FACE_API_TOKEN` | — | Required. Hub access and the Inference API |
| `DATABASE_URL` | — | Must use the `asyncpg` driver |
| `CHAT_MODEL` | `meta-llama/Llama-3.1-8B-Instruct` | Writes the answers |
| `CHAT_PROVIDER` | `auto` | Inference partner; `hf-inference` stays on Hugging Face's own endpoint |
| `CHAT_CONTEXT_CHUNKS` | `6` | Passages per question, when a flow does not say |
| `UPLOAD_DIR` / `MODEL_DIR` | `uploads` / `models` | Where documents and model snapshots go |
| `FLOW_DIR` / `EXPORT_DIR` | `flows` / `exports` | Where workflows live, and where deployments are written |
| `VECTOR_DB` | — | A SQLite file of passages. Empty here; set inside a deployed image, which has no database |

Paths resolve against the `backend/` directory rather than the working
directory, so commands behave the same wherever they are run from.

If the Inference API answers `402`, the token is out of monthly credit — wait
for the reset, add credit, or set `CHAT_PROVIDER=hf-inference` to stay on
Hugging Face's own free endpoint rather than a paid partner.
