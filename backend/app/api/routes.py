import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import EmbeddingModelOut, MergeRequest, Ok, SourceOut
from app.config import settings
from app.db.models import DocumentKind, DocumentStatus, Source, SourceDocument
from app.db.session import get_session
from app.services import hf_api, storage

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


async def get_source(session: AsyncSession, source_id: UUID) -> Source:
    source = await session.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="source not found")
    return source


async def load_source(session: AsyncSession, source_id: UUID) -> SourceOut:
    """Re-read a source and serialise it.

    Rows written in this request are still half-loaded in the identity map — a
    freshly flushed source has no `documents` collection yet, and touching one
    from async code would emit a lazy load and raise MissingGreenlet. Reading
    it back through the eager loader settles every attribute in one query.
    """
    result = await session.execute(
        select(Source)
        .where(Source.id == source_id)
        .execution_options(populate_existing=True)
    )
    return SourceOut.model_validate(result.scalar_one())


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


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(session: AsyncSession = Depends(get_session)):
    """Every source, newest first."""
    result = await session.execute(select(Source).order_by(Source.created_at.desc()))
    return [SourceOut.model_validate(source) for source in result.scalars()]


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
        source = await get_source(session, source_id)
        if source.model != model:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"source was embedded with {source.model!r}; "
                    f"every document in it must use the same model"
                ),
            )
    else:
        source = Source(name=name, description=description, model=model)
        session.add(source)
        # Assigns source.id, which the upload paths are built from.
        await session.flush()

    written: list[Path] = []
    try:
        for upload, kind in zip(files, kinds, strict=True):
            document = SourceDocument(
                id=uuid4(),
                source_id=source.id,
                name=upload.filename or "untitled",
                size=0,
                kind=kind,
                status=DocumentStatus.QUEUED,
            )
            path = storage.document_path(source.id, document.id, kind)
            document.size = await storage.save_upload(upload, path)
            written.append(path)
            session.add(document)
    except Exception:
        # The transaction will roll back; take the orphaned bytes with it.
        for path in written:
            await storage.remove_document(path)
        raise

    # Adding a child does not dirty the parent, so `onupdate` never fires;
    # the list view sorts on this, so set it here.
    source.updated_at = datetime.now(UTC)

    await session.flush()
    return await load_source(session, source.id)


@router.post("/sources/merge", response_model=SourceOut)
async def merge_sources(
    body: MergeRequest, session: AsyncSession = Depends(get_session)
) -> SourceOut:
    """Combine several sources into a new one.

    Every source has to share an embedding model, since the merged vectors are
    only comparable if they came from the same one.
    """
    result = await session.execute(
        select(Source).where(Source.id.in_(body.source_ids))
    )
    picked = list(result.scalars())

    missing = set(body.source_ids) - {source.id for source in picked}
    if missing:
        unknown = ", ".join(str(one) for one in sorted(missing))
        raise HTTPException(status_code=404, detail=f"unknown source(s): {unknown}")

    used = {source.model for source in picked}
    if len(used) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"sources use different models: {', '.join(sorted(used))}",
        )

    # Keep the caller's ordering so mergedFrom reads the way it was requested.
    order = {source_id: index for index, source_id in enumerate(body.source_ids)}
    picked.sort(key=lambda source: order[source.id])

    merged = Source(
        name=body.name,
        model=picked[0].model,
        merged_from=[source.name for source in picked],
    )
    session.add(merged)
    await session.flush()

    copied: list[Path] = []
    try:
        for original in picked:
            for document in original.documents:
                copy = SourceDocument(
                    id=uuid4(),
                    name=document.name,
                    size=document.size,
                    kind=document.kind,
                    status=document.status,
                    chunks=document.chunks,
                    error=document.error,
                )
                copy.source_id = merged.id
                destination = storage.document_path(merged.id, copy.id, copy.kind)
                await storage.copy_document(
                    storage.document_path(original.id, document.id, document.kind),
                    destination,
                )
                copied.append(destination)
                session.add(copy)
    except Exception:
        for path in copied:
            await storage.remove_document(path)
        raise

    await session.flush()
    response = await load_source(session, merged.id)

    if not body.keep_originals:
        for original in picked:
            await session.delete(original)
        await session.flush()
        # Only once the rows are gone, so a failed delete leaves the files.
        for original in picked:
            await storage.remove_source(original.id)

    return response


@router.delete("/sources/{source_id}", response_model=Ok)
async def delete_source(
    source_id: UUID, session: AsyncSession = Depends(get_session)
) -> Ok:
    """Delete a source, its document rows, and its uploaded files."""
    source = await get_source(session, source_id)
    await session.delete(source)
    await session.flush()
    await storage.remove_source(source_id)
    return Ok()


@router.delete("/sources/{source_id}/documents/{document_id}", response_model=Ok)
async def delete_document(
    source_id: UUID,
    document_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Ok:
    """Delete a single document from a source."""
    document = await session.get(SourceDocument, document_id)
    if document is None or document.source_id != source_id:
        raise HTTPException(status_code=404, detail="document not found")

    path = storage.document_path(source_id, document.id, document.kind)
    await session.delete(document)
    await session.flush()
    await storage.remove_document(path)
    return Ok()
