import asyncio
import logging
from collections.abc import Mapping
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import session_factory
from app.db.sql import sql
from app.services import hf_api, storage

logger = logging.getLogger(__name__)

# How often the progress poller measures the snapshot directory.
POLL_SECONDS = 1.0

# asyncio only holds a weak reference to a running task, so a download left to
# itself can be collected mid-flight. Tasks stay in here until they finish.
_running: set[asyncio.Task] = set()


async def register_model(session: AsyncSession, model_id: str) -> None:
    """Make sure the catalogue has a row for this id.

    Sources point at `embedding_models` with a foreign key, so a model has to
    be registered before anything can reference it — downloaded or not.
    """
    await session.execute(sql("model_register"), {"id": model_id})


async def active_job(session: AsyncSession, model_id: str) -> Mapping | None:
    """The unfinished job for this model, if one is already going."""
    result = await session.execute(sql("job_active_for_model"), {"model_id": model_id})
    return result.mappings().first()


async def start_download(session: AsyncSession, model_id: str) -> Mapping:
    """Queue a download and hand back the job to poll.

    Returns the job already in flight if there is one, so a caller retrying
    does not start the same download twice.
    """
    running = await active_job(session, model_id)
    if running is not None:
        return running

    await register_model(session, model_id)
    result = await session.execute(
        sql("job_create"), {"id": uuid4(), "model_id": model_id}
    )
    job = result.mappings().one()

    # The worker opens its own session, so the job row has to be visible to it
    # before the task starts — the request's own commit comes too late.
    await session.commit()

    task = asyncio.create_task(run_download(job["id"], model_id))
    _running.add(task)
    task.add_done_callback(_running.discard)

    return job


async def _run(name: str, params: dict) -> None:
    """Run one statement on its own session, for use away from a request."""
    async with session_factory() as session:
        await session.execute(sql(name), params)
        await session.commit()


async def _track_progress(job_id: UUID, destination: Path, total: int | None) -> None:
    """Write the snapshot's size to the job row until cancelled.

    This is the only progress the Hub client gives us for free: measure what
    has landed on disk. Partial files and the client's own cache are included,
    so the reading is clamped to the repo size rather than sailing past 100%.
    """
    while True:
        await asyncio.sleep(POLL_SECONDS)
        if not destination.exists():
            continue
        try:
            size = await storage.directory_size(destination)
        except OSError:
            # Files move around underneath the walk; the next tick will do.
            continue
        if total is not None:
            size = min(size, total)
        await _run("job_progress", {"id": job_id, "downloaded_bytes": size})


async def run_download(job_id: UUID, model_id: str) -> None:
    """Fetch the repo, recording progress and the outcome on the job.

    Runs detached from the request that asked for it, so every failure has to
    land on the row — nothing is watching this coroutine.
    """
    destination = storage.model_path(model_id)
    progress: asyncio.Task | None = None

    try:
        total = await asyncio.to_thread(hf_api.get_repo_size, model_id)
        await _run("job_start", {"id": job_id, "total_bytes": total})

        progress = asyncio.create_task(_track_progress(job_id, destination, total))

        local_path = await hf_api.download_model(model_id, str(destination))
        details = await asyncio.to_thread(hf_api.get_model_details, model_id)
        size_bytes = await storage.directory_size(destination)
    except Exception as exc:
        logger.warning("download of %s failed", model_id, exc_info=True)
        await _run(
            "job_failed",
            {"id": job_id, "error": f"{type(exc).__name__}: {exc}"[:2000]},
        )
        return
    finally:
        if progress is not None:
            progress.cancel()

    async with session_factory() as session:
        await session.execute(
            sql("model_record_download"),
            {
                "id": model_id,
                "author": details["author"],
                "downloads": details["downloads"],
                "likes": details["likes"],
                "pipeline_tag": details["pipeline_tag"],
                "library_name": details["library_name"],
                "tags": details["tags"],
                "local_path": str(local_path),
                "size_bytes": size_bytes,
            },
        )
        # Progress finishes at exactly the total: the snapshot on disk also
        # carries the Hub client's own cache, so the measured size runs a little
        # past what the repo weighs. `size_bytes` above keeps the true figure.
        await session.execute(
            sql("job_succeeded"),
            {
                "id": job_id,
                "downloaded_bytes": total if total is not None else size_bytes,
            },
        )
        await session.commit()

    logger.info("downloaded %s to %s (%d bytes)", model_id, local_path, size_bytes)
