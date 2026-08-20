import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes import router
from app.db.session import engine, get_session

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Check the database once at boot and release the pool on shutdown.

    A failed check warns rather than aborts: the Hugging Face routes do not
    need Postgres, so a down database should not block working on them. Ask
    /health for the truth about the connection.
    """
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        logger.info("database connection ok")
    except Exception:
        logger.warning("database unreachable at startup", exc_info=True)

    yield

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
        await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "up"}
    except Exception:
        logger.warning("database health check failed", exc_info=True)
        return {"status": "degraded", "database": "down"}
