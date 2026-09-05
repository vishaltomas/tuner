from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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


class FlowNodeIn(BaseModel):
    """One widget on the canvas, as the browser draws it."""

    id: str = Field(min_length=1, max_length=64)
    kind: Literal[
        "input",
        "source",
        "embed",
        "reranker",
        "router",
        "agent",
        "system",
        "output",
    ]
    position: dict[str, float]
    # Per-kind settings. Left loose on purpose: the widget catalogue is still
    # growing, and `rag.workflow` is what decides what a config means. Only
    # `kind` is constrained here, because that is what picks the node function.
    config: dict = Field(default_factory=dict)


class FlowEdgeIn(BaseModel):
    """One wire. Endpoints are node ids, checked against the nodes on save."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str = Field(min_length=1, max_length=64)
    source: str = Field(min_length=1, max_length=64)
    target: str = Field(min_length=1, max_length=64)
    #: Which output of the source widget this wire leaves from. Only a Router
    #: has more than one, and it is how a route is told from its siblings.
    source_handle: str | None = Field(default=None, max_length=64)


class FlowGraphIn(BaseModel):
    nodes: list[FlowNodeIn] = Field(default_factory=list, max_length=200)
    edges: list[FlowEdgeIn] = Field(default_factory=list, max_length=400)

    @model_validator(mode="after")
    def wires_join_real_widgets(self) -> "FlowGraphIn":
        """Reject a wire to a widget that is not there.

        A dangling edge is not something the canvas can produce, so it means
        the flow was assembled somewhere else — and it would be dropped
        silently at run time, leaving a flow that quietly did less than it
        appeared to.
        """
        ids = {node.id for node in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError("two widgets share an id")
        for edge in self.edges:
            if edge.source not in ids or edge.target not in ids:
                raise ValueError(f"wire {edge.id!r} joins a widget that is not here")
        return self


class NameIn(BaseModel):
    """Body of the create and rename routes: just a name."""

    name: str = Field(min_length=1, max_length=80)


class WorkflowOut(CamelModel):
    """One workflow, as Chat and the explorer list it."""

    name: str
    #: How many `.flow` files it holds, `main.flow` included.
    flows: int
    updated_at: datetime


class FlowFileOut(CamelModel):
    """One `.flow` file, as the explorer lists it."""

    name: str
    size: int
    updated_at: datetime
    #: `main.flow` is where a run starts; the UI pins it to the top.
    is_main: bool


class FlowOut(CamelModel):
    """A flow file and what is drawn in it."""

    name: str
    is_main: bool
    graph: dict


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
    """Body of POST /chat, posted snake_case by the frontend.

    A question runs the named workflow's `main.flow`, unless `flow` names
    another file in it — which is what lets a sub-flow be tried on its own.
    `source_ids` is the way in when no workflow has been built yet, so a fresh
    install can still ask something.
    """

    message: str = Field(min_length=1, max_length=20_000)
    #: Which workflow to run. Its `main.flow` is the entry point.
    workflow: str | None = Field(default=None, max_length=80)
    #: A flow inside it, to try a sub-flow on its own. Defaults to `main.flow`.
    flow: str | None = Field(default=None, max_length=80)
    source_ids: list[UUID] = Field(default_factory=list)
    # The user's own system message. Empty or absent falls back to
    # `rag.chat.DEFAULT_SYSTEM`, which is also what the UI seeds the box with.
    system: str | None = Field(default=None, max_length=20_000)
    history: list[ChatTurn] = Field(default_factory=list)
    # Passages retrieved for this question; defaults to `chat_context_chunks`.
    top_k: int | None = Field(default=None, ge=1, le=50)

    #: Run the flow rather than the sources named here. Defaults on.
    use_flow: bool = True


class ChatCitationOut(CamelModel):
    """A passage the answer was allowed to draw on.

    Every retrieved passage is returned, cited or not: the marker is the
    model's to use, and the reader is better served seeing what was in front
    of it than only the parts it chose to point at.
    """

    marker: int
    chunk_id: UUID
    # Absent on a passage supplied by a widget rather than retrieved from a
    # document — text typed into a Source widget, or an Agent's own answer.
    document_id: UUID | None = None
    source_id: UUID | None = None
    document_name: str
    pages: list[int]
    score: float
    #: What `score` measures: `similarity` from retrieval, `rerank` from a
    #: cross-encoder, or `given` for a passage a widget supplied.
    score_kind: str = "similarity"
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
