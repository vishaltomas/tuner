import asyncio
import logging
from collections.abc import Mapping, Sequence
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    DownloadJobOut,
    DownloadRequest,
    EmbeddingModelDetailOut,
    EmbeddingModelOut,
    MergeRequest,
    Ok,
    SourceOut,
)
from app.config import settings
from app.db.models import DocumentKind
from app.db.session import get_session
from app.db.sql import sql
from app.services import downloads, hf_api, storage

logger = logging.getLogger(__name__)

router = APIRouter()


def kind_of(filename: str | None) -> DocumentKind:
    """Map a filename to a supported kind, rejecting anything else.

    Mirrors `kindOf` in the frontend's utils, which is what the dropzone
    already filters on — this is the server-side half of that check.
    """
    extension = (filename or "").rsplit(".", 1)[-1].lower()
    try:
        return DocumentKind(extension)
    except ValueError:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported file type: {filename!r}; expected .pdf or .txt",
        ) from None


async def source_row(session: AsyncSession, source_id: UUID) -> Mapping:
    """One source row, or 404."""
    result = await session.execute(sql("source_by_id"), {"id": source_id})
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="source not found")
    return row


async def with_documents(
    session: AsyncSession, sources: Sequence[Mapping]
) -> list[SourceOut]:
    """Attach each source's documents and serialise.

    Raw rows come back flat, so the documents are fetched for the whole batch
    in one query and grouped here rather than per source.
    """
    if not sources:
        return []

    result = await session.execute(
        sql("documents_for_sources"), {"source_ids": [row["id"] for row in sources]}
    )
    grouped: dict[UUID, list[Mapping]] = {}
    for document in result.mappings():
        grouped.setdefault(document["source_id"], []).append(document)

    return [
        SourceOut.model_validate({**row, "documents": grouped.get(row["id"], [])})
        for row in sources
    ]


async def one_source(session: AsyncSession, source_id: UUID) -> SourceOut:
    """Read a source back after writing it.

    Re-reading is what fills in the server-side defaults — timestamps, and the
    documents just inserted — without a second source of truth for them.
    """
    result = await session.execute(sql("source_by_id"), {"id": source_id})
    sources = result.mappings().all()
    return (await with_documents(session, sources))[0]


@router.get("/models", response_model=list[EmbeddingModelOut])
async def list_models(search: str | None = None, limit: int | None = None):
    """Embedding models from the Hub, most downloaded first."""
    try:
        return await asyncio.to_thread(
            hf_api.list_embed_models, search, limit or settings.model_search_limit
        )
    except Exception as exc:
        logger.warning("hub model search failed", exc_info=True)
        raise HTTPException(
            status_code=502, detail="could not reach the Hugging Face Hub"
        ) from exc


@router.get("/models/downloaded", response_model=list[EmbeddingModelDetailOut])
async def list_downloaded_models(session: AsyncSession = Depends(get_session)):
    """Models actually on disk, most recent first."""
    result = await session.execute(sql("models_downloaded"))
    return [EmbeddingModelDetailOut.model_validate(row) for row in result.mappings()]


@router.post("/models/download", response_model=DownloadJobOut, status_code=202)
async def download_model(
    body: DownloadRequest, session: AsyncSession = Depends(get_session)
) -> DownloadJobOut:
    """Queue a model download and return the job to poll.

    Answers as soon as the job row exists — the repo is fetched in the
    background, since a real embedding model is hundreds of megabytes. Poll
    `/jobs/{id}` for progress; a download that cannot start (no such model, Hub
    unreachable) reports itself there as `failed`, not as an error here.
    """
    job = await downloads.start_download(session, body.model_id)
    return DownloadJobOut.model_validate(job)


@router.get("/jobs", response_model=list[DownloadJobOut])
async def list_jobs(
    limit: int = 20, session: AsyncSession = Depends(get_session)
) -> list[DownloadJobOut]:
    """Recent download jobs, newest first."""
    result = await session.execute(sql("jobs_recent"), {"limit": limit})
    return [DownloadJobOut.model_validate(row) for row in result.mappings()]


@router.get("/jobs/{job_id}", response_model=DownloadJobOut)
async def get_job(
    job_id: UUID, session: AsyncSession = Depends(get_session)
) -> DownloadJobOut:
    """One download job, as the caller polls it."""
    result = await session.execute(sql("job_by_id"), {"id": job_id})
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return DownloadJobOut.model_validate(row)


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(session: AsyncSession = Depends(get_session)):
    """Every source, newest first."""
    result = await session.execute(sql("sources_all"))
    return await with_documents(session, result.mappings().all())


@router.post("/embed", response_model=SourceOut)
async def embed(
    name: str = Form(..., min_length=1, max_length=200),
    model: str = Form(..., min_length=1, max_length=200),
    source_id: UUID | None = Form(None),
    description: str | None = Form(None),
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_session),
) -> SourceOut:
    """Store an upload against a new or existing source.

    The documents land as `queued`: this route owns the files and the rows, not
    the embedding itself, which nothing runs yet.
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files uploaded")

    kinds = [kind_of(upload.filename) for upload in files]

    if source_id is not None:
        source = await source_row(session, source_id)
        if source["model"] != model:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"source was embedded with {source['model']!r}; "
                    f"every document in it must use the same model"
                ),
            )
    else:
        # sources.model is a foreign key, so the catalogue needs the id first.
        await downloads.register_model(session, model)
        result = await session.execute(
            sql("source_create"),
            {"name": name, "description": description, "model": model},
        )
        source = result.mappings().one()

    written: list[Path] = []
    try:
        for upload, kind in zip(files, kinds, strict=True):
            document_id = uuid4()
            path = storage.document_path(source["id"], document_id, kind)
            size = await storage.save_upload(upload, path)
            written.append(path)
            await session.execute(
                sql("document_create"),
                {
                    "id": document_id,
                    "source_id": source["id"],
                    "name": upload.filename or "untitled",
                    "size": size,
                    "kind": kind.value,
                },
            )
    except Exception:
        # The transaction will roll back; take the orphaned bytes with it.
        for path in written:
            await storage.remove_document(path)
        raise

    await session.execute(sql("source_touch"), {"id": source["id"]})
    return await one_source(session, source["id"])


@router.post("/sources/merge", response_model=SourceOut)
async def merge_sources(
    body: MergeRequest, session: AsyncSession = Depends(get_session)
) -> SourceOut:
    """Combine several sources into a new one.

    Every source has to share an embedding model, since the merged vectors are
    only comparable if they came from the same one.
    """
    result = await session.execute(sql("sources_by_ids"), {"ids": body.source_ids})
    picked = result.mappings().all()

    missing = set(body.source_ids) - {row["id"] for row in picked}
    if missing:
        unknown = ", ".join(str(one) for one in sorted(missing))
        raise HTTPException(status_code=404, detail=f"unknown source(s): {unknown}")

    used = {row["model"] for row in picked}
    if len(used) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"sources use different models: {', '.join(sorted(used))}",
        )

    # Keep the caller's ordering so mergedFrom reads the way it was requested.
    order = {source_id: index for index, source_id in enumerate(body.source_ids)}
    picked = sorted(picked, key=lambda row: order[row["id"]])

    result = await session.execute(
        sql("source_create_merged"),
        {
            "name": body.name,
            "model": picked[0]["model"],
            "merged_from": [row["name"] for row in picked],
        },
    )
    merged = result.mappings().one()

    documents = await session.execute(
        sql("documents_for_sources"), {"source_ids": [row["id"] for row in picked]}
    )

    copied: list[Path] = []
    try:
        for document in documents.mappings():
            new_id = uuid4()
            kind = DocumentKind(document["kind"])
            destination = storage.document_path(merged["id"], new_id, kind)
            await storage.copy_document(
                storage.document_path(document["source_id"], document["id"], kind),
                destination,
            )
            copied.append(destination)
            await session.execute(
                sql("document_copy"),
                {
                    "new_id": new_id,
                    "new_source_id": merged["id"],
                    "id": document["id"],
                },
            )
    except Exception:
        for path in copied:
            await storage.remove_document(path)
        raise

    response = await one_source(session, merged["id"])

    if not body.keep_originals:
        for row in picked:
            await session.execute(sql("source_delete"), {"id": row["id"]})
        # Only once the rows are gone, so a failed delete leaves the files.
        for row in picked:
            await storage.remove_source(row["id"])

    return response


@router.delete("/sources/{source_id}", response_model=Ok)
async def delete_source(
    source_id: UUID, session: AsyncSession = Depends(get_session)
) -> Ok:
    """Delete a source, its document rows, and its uploaded files."""
    await source_row(session, source_id)
    await session.execute(sql("source_delete"), {"id": source_id})
    await storage.remove_source(source_id)
    return Ok()


@router.delete("/sources/{source_id}/documents/{document_id}", response_model=Ok)
async def delete_document(
    source_id: UUID,
    document_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Ok:
    """Delete a single document from a source."""
    result = await session.execute(sql("document_by_id"), {"id": document_id})
    document = result.mappings().first()
    if document is None or document["source_id"] != source_id:
        raise HTTPException(status_code=404, detail="document not found")

    path = storage.document_path(
        source_id, document["id"], DocumentKind(document["kind"])
    )
    await session.execute(sql("document_delete"), {"id": document_id})
    await storage.remove_document(path)
    return Ok()
