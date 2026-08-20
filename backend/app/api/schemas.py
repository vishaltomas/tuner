from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.db.models import DocumentKind, DocumentStatus


class CamelModel(BaseModel):
    """Base for anything sent to the browser.

    The frontend's `Source` and `SourceDocument` types are camelCase, so
    responses are serialised by alias. Request bodies stay snake_case — that is
    what `lib/api.ts` posts — which `populate_by_name` keeps working.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class EmbeddingModelOut(CamelModel):
    id: str
    # Absent from the Hub listing; the UI simply omits the badge.
    dimensions: int | None = None
    downloads: int | None = None
    library: str | None = None


class SourceDocumentOut(CamelModel):
    id: UUID
    name: str
    size: int
    kind: DocumentKind
    status: DocumentStatus
    chunks: int | None = None
    error: str | None = None
    added_at: datetime


class SourceOut(CamelModel):
    id: UUID
    name: str
    description: str | None = None
    model: str
    created_at: datetime
    updated_at: datetime
    merged_from: list[str] | None = None
    documents: list[SourceDocumentOut]


class MergeRequest(BaseModel):
    """Body of POST /sources/merge, posted snake_case by the frontend."""

    source_ids: list[UUID] = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    keep_originals: bool = False


class Ok(BaseModel):
    """The `{ ok: true }` the delete routes are checked against."""

    ok: bool = True
