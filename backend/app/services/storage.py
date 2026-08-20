import asyncio
import shutil
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile

from app.config import BASE_DIR, settings
from app.db.models import DocumentKind

# Uploads live at <upload_dir>/<source id>/<document id>.<kind>, so a path is
# always derivable from the row and no column has to store it. Merging copies
# the bytes rather than sharing them, which keeps every document's file its
# own — deleting one source can never pull a file out from under another.


def source_dir(source_id: UUID) -> Path:
    return BASE_DIR / settings.upload_dir / str(source_id)


def document_path(source_id: UUID, document_id: UUID, kind: DocumentKind) -> Path:
    return source_dir(source_id) / f"{document_id}.{kind.value}"


def _write(upload: UploadFile, destination: Path) -> None:
    upload.file.seek(0)
    with destination.open("wb") as out:
        shutil.copyfileobj(upload.file, out)


async def save_upload(upload: UploadFile, destination: Path) -> int:
    """Write an upload to disk and return its size in bytes.

    The copy runs in a thread: uploads over the spool limit are real files, and
    a large one would otherwise stall the event loop.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(_write, upload, destination)
    return destination.stat().st_size


async def copy_document(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(shutil.copyfile, source, destination)


async def remove_document(path: Path) -> None:
    await asyncio.to_thread(path.unlink, True)


async def remove_source(source_id: UUID) -> None:
    await asyncio.to_thread(shutil.rmtree, source_dir(source_id), True)
