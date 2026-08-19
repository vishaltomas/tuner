from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from config import settings


class Base(DeclarativeBase):
    """Declarative base every ORM model inherits from.

    Alembic autogenerate reads `Base.metadata`, so a model is only visible to
    migrations once its module has been imported (see `migrations/env.py`).
    """


engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    # WSL and laptop suspends drop idle connections; check before handing one out.
    pool_pre_ping=True,
)

session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that owns its transaction.

    The session commits when the route returns and rolls back if it raises, so
    routes only describe the change. `expire_on_commit=False` keeps ORM objects
    readable after the commit, which response serialisation depends on.
    """
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
