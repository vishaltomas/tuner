from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.db.models import DocumentKind, DocumentStatus, DownloadStatus


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


class EmbeddingModelDetailOut(CamelModel):
    id: str
    author: str | None = None
    downloads: int | None = None
    likes: int | None = None
    pipeline_tag: str | None = None
    library_name: str | None = None
    tags: list[str] | None = None
    # Null until a download finishes; these three move together.
    local_path: str | None = None
    size_bytes: int | None = None
    downloaded_at: datetime | None = None
    created_at: datetime


class DownloadJobOut(CamelModel):
    """What a caller polls while a download runs."""

    id: UUID
    model_id: str
    status: DownloadStatus
    downloaded_bytes: int
    total_bytes: int | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None


class DownloadRequest(BaseModel):
    """Body of POST /models/download."""

    model_id: str = Field(min_length=1, max_length=200)

    @field_validator("model_id")
    @classmethod
    def safe_as_a_path(cls, value: str) -> str:
        """Reject anything that would not stay inside the models directory.

        The id is used verbatim as a directory name, so `../..` or an absolute
        path would otherwise write wherever it pointed.
        """
        segments = value.split("/")
        if (
            len(segments) > 2
            or any(segment in ("", ".", "..") for segment in segments)
            or "\\" in value
        ):
            raise ValueError("expected a Hugging Face id like 'owner/name'")
        return value


class MergeRequest(BaseModel):
    """Body of POST /sources/merge, posted snake_case by the frontend."""

    source_ids: list[UUID] = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    keep_originals: bool = False


class ChatTurn(BaseModel):
    """One earlier turn, replayed by the browser.

    The conversation is not stored server-side — nothing here has a chat
    table — so the client sends back what it is showing. Only the two roles a
    transcript can hold are accepted; the system message travels separately,
    on `ChatRequest`, where the user can edit it between turns.
    """

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    """Body of POST /chat, posted snake_case by the frontend."""

    message: str = Field(min_length=1, max_length=20_000)
    source_ids: list[UUID] = Field(min_length=1)
    # The user's own system message. Empty or absent falls back to
    # `rag.chat.DEFAULT_SYSTEM`, which is also what the UI seeds the box with.
    system: str | None = Field(default=None, max_length=20_000)
    history: list[ChatTurn] = Field(default_factory=list)
    # Passages retrieved for this question; defaults to `chat_context_chunks`.
    top_k: int | None = Field(default=None, ge=1, le=50)


class ChatCitationOut(CamelModel):
    """A passage the answer was allowed to draw on.

    Every retrieved passage is returned, cited or not: the marker is the
    model's to use, and the reader is better served seeing what was in front
    of it than only the parts it chose to point at.
    """

    marker: int
    chunk_id: UUID
    document_id: UUID
    source_id: UUID
    document_name: str
    pages: list[int]
    # Cosine similarity to the question, in [-1, 1].
    score: float
    text: str


class ChatReplyOut(CamelModel):
    answer: str
    citations: list[ChatCitationOut]
    # Echoed back so the UI can name the model that wrote the answer without
    # a second round trip for the setting.
    model: str


class ChatDefaultsOut(CamelModel):
    """What the chat pane needs before the first question is asked."""

    system: str
    model: str
    context_chunks: int


class Ok(BaseModel):
    """The `{ ok: true }` the delete routes are checked against."""

    ok: bool = True
