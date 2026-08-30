import asyncio
import importlib
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes import router
from app.db.session import engine, get_session
from app.db.sql import sql

logger = logging.getLogger(__name__)


async def warm_rag() -> None:
    """Import the RAG stack in the background, off the critical path.

    `app.rag.native` reaches torch, transformers and unstructured's layout
    stack — tens of seconds of import, and minutes on a slow filesystem. At
    module scope that would hold the server off its port for the whole of it,
    even though most routes never touch any of it. Importing it here instead
    means the app answers immediately and the stack loads behind it; a request
    that arrives first simply waits on the import lock, which is exactly the
    wait it would have paid anyway.
    """
    try:
        await asyncio.to_thread(importlib.import_module, "app.rag.native")
        logger.info("rag pipeline ready")
    except Exception:
        # Not fatal: everything but embedding and chat still works, and the
        # routes that need it will raise the same error where it can be seen.
        logger.warning("rag pipeline could not be imported", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Check the database, warm the RAG stack, and release the pool on exit.

    A failed check warns rather than aborts: the Hugging Face routes do not
    need Postgres, so a down database should not block working on them. Ask
    /health for the truth about the connection.
    """
    try:
        async with engine.connect() as connection:
            await connection.execute(sql("health_check"))
        logger.info("database connection ok")
    except Exception:
        logger.warning("database unreachable at startup", exc_info=True)

    warming = asyncio.create_task(warm_rag())

    yield

    # A shutdown during startup should not leave the import running.
    warming.cancel()
    await engine.dispose()


app = FastAPI(lifespan=lifespan)

# Vite proxies /api/* here with the prefix stripped, so these sit at the
# root and no CORS handling is needed in dev.
app.include_router(router)


@app.get("/")
async def root():
    return


@app.get("/health")
async def health(session: AsyncSession = Depends(get_session)):
    """Report whether the process can currently reach Postgres."""
    try:
        await session.execute(sql("health_check"))
        return {"status": "ok", "database": "up"}
    except Exception:
        logger.warning("database health check failed", exc_info=True)
        return {"status": "degraded", "database": "down"}
