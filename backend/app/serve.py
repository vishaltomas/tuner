"""The entrypoint an exported image runs.

One workflow, two routes: ask it something, or check it is up. Everything the
editor does — uploading documents, downloading models, drawing flows — is
absent, because a deployment has nothing to edit and no database to edit into.

What it does share is the part that matters: the same `Workflow` compiler, the
same widgets, the same retrieval. A deployed answer and a local one come from
one implementation rather than two that drift.
"""

import asyncio
import importlib
import logging
import os
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.config import settings
from app.rag.workflow import Workflow, WorkflowError
from app.services.flows import MAIN, FlowError, flows

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Which workflow this image was built from. The export writes it into the
# image; falling back to the only directory present keeps a hand-built context
# working rather than failing on a missing variable.
WORKFLOW = os.environ.get("TUNER_WORKFLOW", "")


class Ask(BaseModel):
    """A question, and optionally what was said before it."""

    message: str = Field(min_length=1, max_length=20_000)
    #: Prior turns, oldest first, as `[role, content]`. Only used when the
    #: workflow has a Chat source widget wired in — otherwise it is ignored,
    #: because nothing asked for it.
    history: list[tuple[str, str]] = Field(default_factory=list, max_length=40)
    #: A flow inside the workflow, to run one on its own. Defaults to main.
    flow: str | None = Field(default=None, max_length=80)


class Citation(BaseModel):
    # `from_attributes` because the citations arrive as slotted dataclasses
    # from the flow, not as dictionaries.
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    marker: int
    document_name: str
    pages: list[int]
    score: float
    score_kind: str
    text: str


class Answer(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    answer: str
    citations: list[Citation]
    workflow: str


async def resolve_workflow() -> str:
    """Which workflow to run, checked once at boot so a mistake is loud."""
    if WORKFLOW:
        return WORKFLOW
    found = await flows.list_workflows()
    if len(found) == 1:
        return found[0].name
    raise RuntimeError(
        "set TUNER_WORKFLOW: this image carries "
        f"{len(found)} workflows and cannot choose between them"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the workflow at boot rather than on the first question.

    A deployment that cannot run should fail its health check immediately,
    not look healthy until someone asks it something.
    """
    app.state.workflow = await resolve_workflow()
    app.state.ready = False
    app.state.problem = ""

    # Checked here rather than left to the first question: without it every
    # answer fails at the inference call with an authentication error, which
    # says nothing about the container being started wrong.
    if not settings.hugging_face_api_token:
        app.state.problem = (
            "HUGGING_FACE_API_TOKEN is not set, so this workflow cannot reach "
            "a model to answer with. Pass it with -e when starting the container."
        )
        logger.error("this image cannot answer: %s", app.state.problem)
        yield
        return

    try:
        workflow = await Workflow.load(app.state.workflow)
        problems = workflow.problems()
        if problems:
            app.state.problem = problems[0]
        else:
            app.state.ready = True
            logger.info("serving %s from %s", MAIN, app.state.workflow)
    except (WorkflowError, FlowError) as exc:
        app.state.problem = str(exc)

    if app.state.problem:
        logger.error("this image cannot answer: %s", app.state.problem)

    # Torch, transformers and the embedding weights are tens of seconds of
    # import. Warming them behind the server means the container answers its
    # health check straight away and the first question is not the one that
    # pays; a question arriving first simply waits on the import lock.
    warming = asyncio.create_task(_warm())

    yield

    warming.cancel()


app = FastAPI(title="Tuner workflow", lifespan=lifespan)


async def _warm() -> None:
    """Import the model stack off the critical path."""
    try:
        await asyncio.to_thread(importlib.import_module, "app.rag.native")
        logger.info("model stack ready")
    except Exception:
        logger.warning("model stack could not be imported", exc_info=True)


def _passage_count() -> int:
    """How many passages this image carries.

    Counted straight out of the file rather than through `Passages`, which
    lives beside the model stack: importing that to answer a health check
    would make the first one take minutes and fail its own timeout.
    """
    if not settings.vector_db:
        return 0
    try:
        with sqlite3.connect(f"file:{settings.vector_db}?mode=ro", uri=True) as db:
            return db.execute("SELECT count(*) FROM passages").fetchone()[0]
    except sqlite3.Error:
        return 0


@app.get("/health")
async def health():
    """Whether this image can answer, and what it holds."""
    passages = await asyncio.to_thread(_passage_count)

    return {
        "status": "ok" if app.state.ready else "unhealthy",
        "workflow": app.state.workflow,
        "passages": passages,
        "problem": app.state.problem or None,
    }


@app.post("/ask", response_model=Answer)
async def ask(body: Ask) -> Answer:
    """Run the workflow over one question."""
    if not app.state.ready:
        # 503 rather than 500: the request was fine, the image is not, and a
        # load balancer should take it out rather than retry the caller.
        raise HTTPException(status_code=503, detail=app.state.problem)

    name = body.flow or MAIN
    try:
        workflow = await Workflow.load(app.state.workflow, name)
        text, citations = await workflow.run(body.message, body.history)
    except (WorkflowError, FlowError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("run failed", exc_info=True)
        raise HTTPException(
            status_code=502, detail=f"could not answer: {type(exc).__name__}"
        ) from exc

    return Answer(
        answer=text,
        citations=[Citation.model_validate(one) for one in citations],
        workflow=app.state.workflow,
    )
