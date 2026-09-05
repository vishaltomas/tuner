"""Packaging a workflow as something that can be run somewhere else.

What comes out is a Docker build context: the workflow's flows, the passages
they retrieve from, the embedding model that made those passages, and the app
code that runs them. It is deliberately self-contained — the image carries its
vectors in a SQLite file rather than reaching for the Postgres this app uses,
so a deployment needs nothing but a Hugging Face token.

The image is a snapshot. Embedding more documents here does not change what a
built image answers from; that is the price of it running anywhere, and the
export writes the date it was taken so the two are not confused.
"""

import asyncio
import json
import logging
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from app.config import BASE_DIR, settings
from app.db.session import session_factory
from app.db.sql import sql
from app.services import storage
from app.services.flows import MAIN, FlowError, Flows, flows

logger = logging.getLogger(__name__)

# How long `docker build` is given before it is abandoned. A first build pulls
# a base image and installs torch, which is slow but not unbounded.
BUILD_TIMEOUT = 1800

# The port the exported service listens on, and the tag prefix its image gets.
PORT = 8080
TAG_PREFIX = "tuner"


@dataclass(frozen=True, slots=True)
class Deployment:
    """What an export produced, and whether it became an image."""

    workflow: str
    #: Where the build context was written.
    directory: str
    image: str
    #: Flows, passages and megabytes that went in, for the UI to report.
    flows: int
    passages: int
    size_mb: float
    #: True when the embedding model went in too. When it did not, the image
    #: downloads it on first start and needs network to do so.
    model_included: bool
    model: str | None
    #: Whether `docker build` ran here, and what it said if it did not.
    built: bool
    build_note: str
    exported_at: datetime


class Deploy:
    """Turns one workflow into a Docker build context, and maybe an image.

    Everything an export needs to decide — which sources the flows retrieve
    from, which model embedded them, what to copy — is derived from the flow
    files themselves, so a workflow is packaged as it is drawn rather than
    from anything recorded on the side.
    """

    def __init__(self, workflow: str, store: Flows | None = None):
        self.workflow = workflow
        self.store = store or flows
        self.directory = BASE_DIR / settings.export_dir / _slug(workflow)
        self.image = f"{TAG_PREFIX}-{_slug(workflow)}:latest"

    async def export(self, build: bool = True) -> Deployment:
        """Write the build context, and build it if a daemon will have it."""
        graphs = await self._graphs()
        source_ids = _sources_in(graphs)
        model = await self._model(source_ids)

        await asyncio.to_thread(shutil.rmtree, self.directory, True)
        await asyncio.to_thread(self.directory.mkdir, parents=True, exist_ok=True)

        await self._copy_flows(graphs)
        passages = await self._write_vectors(source_ids, model)
        included = await self._copy_model(model)
        await asyncio.to_thread(self._copy_app)
        await asyncio.to_thread(self._write_dockerfile, model, included)
        await asyncio.to_thread(self._write_readme, model, included, passages)

        built, note = (
            False,
            "The image was not built. The build context is ready — run "
            "docker build in it wherever the image should be made.",
        )
        if build:
            built, note = await self._build()

        return Deployment(
            workflow=self.workflow,
            directory=str(self.directory),
            image=self.image,
            flows=len(graphs),
            passages=passages,
            size_mb=round(await storage.directory_size(self.directory) / 1_048_576, 1),
            model_included=included,
            model=model,
            built=built,
            build_note=note,
            exported_at=datetime.now(UTC),
        )

    async def _graphs(self) -> dict[str, dict]:
        """Every flow in the workflow, by filename."""
        try:
            listing = await self.store.list(self.workflow)
        except FlowError as exc:
            raise FlowError(str(exc)) from exc

        if not any(one.is_main for one in listing):
            raise FlowError(f"{self.workflow} has no {MAIN} to run")

        return {
            one.name: await self.store.read(self.workflow, one.name) for one in listing
        }

    async def _model(self, source_ids: list[UUID]) -> str | None:
        """The embedding model the workflow's sources were embedded with."""
        if not source_ids:
            return None

        async with session_factory() as session:
            result = await session.execute(sql("sources_by_ids"), {"ids": source_ids})
            rows = result.mappings().all()

        missing = set(source_ids) - {row["id"] for row in rows}
        if missing:
            raise FlowError(
                "a flow points at a source that no longer exists; open the "
                "workflow and pick another before deploying"
            )

        models = {row["model"] for row in rows}
        if len(models) > 1:
            raise FlowError(
                f"its flows mix embedding models ({', '.join(sorted(models))}); "
                f"one image can only carry one"
            )
        return models.pop()

    async def _copy_flows(self, graphs: dict[str, dict]) -> None:
        target = self.directory / "flows" / self.workflow
        await asyncio.to_thread(target.mkdir, parents=True, exist_ok=True)
        for name, graph in graphs.items():
            await asyncio.to_thread(
                (target / name).write_text, json.dumps(graph, indent=2) + "\n"
            )

    async def _write_vectors(self, source_ids: list[UUID], model: str | None) -> int:
        """Copy the passages those sources hold into a SQLite file."""
        rows: list[dict] = []
        if source_ids:
            async with session_factory() as session:
                result = await session.execute(
                    sql("chunks_for_sources"), {"source_ids": source_ids}
                )
                rows = [dict(row) for row in result.mappings()]

        await asyncio.to_thread(self._write_sqlite, rows, model)
        return len(rows)

    def _write_sqlite(self, rows: list[dict], model: str | None) -> None:
        path = self.directory / "vectors.db"
        with sqlite3.connect(path) as database:
            database.execute("""
                CREATE TABLE passages (
                    id            TEXT PRIMARY KEY,
                    document_id   TEXT NOT NULL,
                    source_id     TEXT NOT NULL,
                    ordinal       INTEGER NOT NULL,
                    text          TEXT NOT NULL,
                    tokens        INTEGER NOT NULL,
                    pages         TEXT,
                    embedding     TEXT NOT NULL,
                    document_name TEXT NOT NULL
                )
            """)
            database.execute("CREATE INDEX ix_passages_source ON passages (source_id)")
            # Which model embedded these. A vector only means something in the
            # space it was made in, and the image has no database to ask — so
            # the fact travels with the vectors rather than beside them.
            database.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
            database.executemany(
                "INSERT INTO meta VALUES (?, ?)",
                [
                    ("model", model or ""),
                    ("workflow", self.workflow),
                    ("exported_at", datetime.now(UTC).isoformat()),
                ],
            )
            database.executemany(
                "INSERT INTO passages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        str(row["id"]),
                        str(row["document_id"]),
                        str(row["source_id"]),
                        row["ordinal"],
                        row["text"],
                        row["tokens"],
                        json.dumps(list(row["pages"])) if row["pages"] else None,
                        json.dumps(list(row["embedding"])),
                        row["document_name"],
                    )
                    for row in rows
                ],
            )

    async def _copy_model(self, model: str | None) -> bool:
        """Copy the embedding model in, if this install has it on disk."""
        if not model:
            return False
        local = storage.model_path(model)
        if not local.is_dir():
            return False
        target = self.directory / "models" / model
        await asyncio.to_thread(shutil.copytree, local, target, dirs_exist_ok=True)
        return True

    def _copy_app(self) -> None:
        """The application package, minus what a deployment cannot use.

        The image runs the same code this app does — the same widgets, the
        same LangGraph compilation — so a deployed answer and a local one come
        from one implementation rather than two that drift.
        """
        shutil.copytree(
            BASE_DIR / "app",
            self.directory / "app",
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "_samples"),
        )

    def _write_dockerfile(self, model: str | None, included: bool) -> None:
        pull = "" if included or not model else f"""
# The embedding model is not on the build machine, so it is fetched here.
# Baking it in keeps the first question fast and the container offline after.
ARG HUGGING_FACE_API_TOKEN=
RUN python -c "\\
from huggingface_hub import snapshot_download; \\
snapshot_download('{model}', local_dir='/app/models/{model}')"
"""
        (self.directory / "Dockerfile").write_text(f"""\
# Generated by Tuner from the workflow "{self.workflow}".
# Self-contained: the flows, their passages and the embedding model are all
# inside, so this needs no database — only a Hugging Face token to answer.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \\
    PIP_NO_CACHE_DIR=1 \\
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /app

# Installed before the app is copied so a flow edit does not reinstall torch.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ /app/app/
COPY flows/ /app/flows/
COPY vectors.db /app/vectors.db
{"COPY models/ /app/models/" if included else ""}
{pull}
# What makes this a deployment rather than the editor: retrieval reads the
# SQLite file above, and the only route served is the one that answers.
ENV FLOW_DIR=/app/flows \\
    MODEL_DIR=/app/models \\
    VECTOR_DB=/app/vectors.db \\
    TUNER_WORKFLOW="{self.workflow}" \\
    PORT={PORT}

# Settings the editor needs and a deployment does not. They are given inert
# values rather than left unset because the configuration is validated at
# import: without them the container would die before it could explain why.
# Nothing here connects to a database — retrieval reads VECTOR_DB above.
ENV DATABASE_URL="postgresql+asyncpg://unused@127.0.0.1/unused" \\
    EMBEDDING_PIPELINE_TAG=feature-extraction \\
    EMBEDDING_LIBRARY=sentence-transformers \\
    API_CLIENT_TTL=3600 \\
    HUGGING_FACE_API_TOKEN=""

EXPOSE {PORT}
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \\
  CMD python -c "import urllib.request as u; \
u.urlopen('http://127.0.0.1:{PORT}/health')"

CMD ["python", "-m", "uvicorn", "app.serve:app", \\
     "--host", "0.0.0.0", "--port", "{PORT}"]
""")

        # Only what answering needs. The editor's own dependencies — Alembic,
        # the Postgres drivers, the document parsers — have nothing to do in
        # an image that neither migrates a database nor ingests a file.
        (self.directory / "requirements.txt").write_text("""\
fastapi>=0.141.1
uvicorn[standard]>=0.52.3
pydantic-settings>=2.15.0
huggingface-hub>=1.27.0
langgraph>=1.2
torch>=2.0
transformers>=4.40
""")

    def _write_readme(self, model: str | None, included: bool, passages: int) -> None:
        (self.directory / "README.md").write_text(f"""\
# {self.workflow}

A deployable snapshot of this workflow, exported {datetime.now(UTC):%d %B %Y}.

It carries its own passages ({passages:,}) and{'' if included else ' downloads'} \
its embedding model{'' if not model else f' ({model})'}, so it needs no database.

## Build

```
docker build -t {self.image} .
```

## Run

```
docker run --rm -p {PORT}:{PORT} \\
  -e HUGGING_FACE_API_TOKEN=hf_... \\
  {self.image}
```

## Ask it something

```
curl -s localhost:{PORT}/ask \\
  -H 'Content-Type: application/json' \\
  -d '{{"message": "your question"}}'
```

The reply carries the answer and the passages it rested on, the same way the
chat pane shows them.

`GET /health` reports whether the workflow loaded and how many passages it
holds — useful as a container health check, which the image already uses.

## What is inside

| | |
|---|---|
| Flows | `flows/{self.workflow}/` — `{MAIN}` is where a run starts |
| Passages | `vectors.db`, a SQLite snapshot |
| Model | {"baked in" if included else "downloaded on first start"} |

The vectors are a snapshot. Embedding more documents in Tuner does not change
what this image answers from — rebuild it to pick them up.
""")

    async def _build(self) -> tuple[bool, str]:
        """Run `docker build`, if a daemon will take it."""
        docker = shutil.which("docker")
        if not docker:
            return False, (
                "Docker is not on this machine's PATH, so the image was not "
                "built. The build context is ready; run docker build in it."
            )

        try:
            done = await asyncio.to_thread(
                subprocess.run,
                [docker, "build", "-t", self.image, "."],
                cwd=self.directory,
                capture_output=True,
                text=True,
                timeout=BUILD_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return False, f"docker build ran longer than {BUILD_TIMEOUT // 60} minutes."
        except OSError as exc:
            return False, f"docker build could not start: {exc}"

        if done.returncode == 0:
            return True, f"Built {self.image}."

        # The last lines are where the reason is; the rest is layer chatter.
        tail = (done.stderr or done.stdout or "").strip().splitlines()[-4:]
        logger.warning("docker build failed for %s: %s", self.workflow, tail)
        return False, "docker build failed: " + " ".join(tail)[:400]


def _slug(name: str) -> str:
    """A workflow name as a Docker tag and directory: lowercase, dashes."""
    kept = [character if character.isalnum() else "-" for character in name.lower()]
    return "".join(kept).strip("-").replace("--", "-") or "workflow"


def _sources_in(graphs: dict[str, dict]) -> list[UUID]:
    """Every source the workflow's Source widgets retrieve from.

    Read from the flows rather than from anything recorded alongside them, so
    what is packaged is what is drawn — including a source reached only
    through a flow some Agent widget calls.
    """
    found: list[UUID] = []
    for graph in graphs.values():
        for node in graph.get("nodes") or []:
            config = node.get("config") or {}
            if node.get("kind") != "source":
                continue
            if (config.get("sourceType") or "files") != "files":
                continue
            for one in config.get("sourceIds") or []:
                identifier = UUID(str(one))
                if identifier not in found:
                    found.append(identifier)
    return found
