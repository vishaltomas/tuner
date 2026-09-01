"""Schema of record.

Nothing queries through these mappings — every statement in the app lives
in `app/sql/` and is executed as SQL. They are declared because Alembic
compares this metadata against the live database: `alembic check` is what
catches a hand-written migration drifting from the schema it claims.
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    REAL,
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class DocumentKind(StrEnum):
    PDF = "pdf"
    TXT = "txt"


class DocumentStatus(StrEnum):
    QUEUED = "queued"
    EMBEDDING = "embedding"
    READY = "ready"
    FAILED = "failed"


class Source(Base):
    """One upload session: a named set of documents sharing an embedding model.

    Mirrors the `Source` shape the frontend already renders, so a stored row
    can be serialised straight back to it.
    """

    __tablename__ = "sources"


    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # Hugging Face id of the model used for every document in this source.
    # A source may name a model that has not been downloaded, so /embed
    # registers the id first; the row is what this points at.
    model: Mapped[str] = mapped_column(
        String(200),
        ForeignKey("embedding_models.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # Names of the sources this one was merged from, if any.
    merged_from: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    embedding_model: Mapped["EmbeddingModel"] = relationship()

    documents: Mapped[list["SourceDocument"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="SourceDocument.added_at",
    )


class SourceDocument(Base):
    """A single uploaded file and how far its embedding run got."""

    __tablename__ = "source_documents"


    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    # Size in bytes; BigInteger because a 2GB corpus overflows int4.
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[DocumentKind] = mapped_column(
        Enum(
            DocumentKind,
            name="document_kind",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(
            DocumentStatus,
            name="document_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=DocumentStatus.QUEUED,
    )
    # Number of vectors written for this document, once embedded.
    chunks: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    source: Mapped[Source] = relationship(back_populates="documents")

    __table_args__ = (Index("ix_source_documents_source_id", "source_id"),)


class DocumentChunk(Base):
    """One passage of one document, as chunked for embedding.

    Written by `rag.native.NativeRAG`. The text is kept alongside whatever
    vector is derived from it, because retrieval has to hand back something
    readable: a vector alone cannot be shown to anyone. `tokens` is the length
    the source's tokenizer measured, so nothing has to re-encode a passage to
    know whether it fits the model.
    """

    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("source_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Position within the document. Named `ordinal` because `index` reads as
    # the DDL keyword everywhere it is written unquoted.
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    # Pages the passage drew on; null for a text file, which has none.
    pages: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    # The passage as its model sees it, L2 normalised so cosine similarity is
    # a dot product. Null until the passage has been embedded. REAL[] because
    # pgvector is not installed; see migrations/sql/0005_upgrade.sql.
    embedding: Mapped[list[float] | None] = mapped_column(ARRAY(REAL))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    document: Mapped["SourceDocument"] = relationship()

    __table_args__ = (
        # Chunking a document again replaces its passages, so a position can
        # only appear once: a rerun that half-finished cannot leave two.
        UniqueConstraint(
            "document_id", "ordinal", name="uq_document_chunks_document_id_ordinal"
        ),
        Index("ix_document_chunks_document_id", "document_id"),
    )


class EmbeddingModel(Base):
    """A model this install knows about, downloaded or not.

    Keyed by Hugging Face id, so downloading again refreshes the row instead of
    adding a second one. A row appears as soon as something names the model —
    embedding against it, or asking for a download — and the `local_path`,
    `size_bytes` and `downloaded_at` columns stay null until a download
    finishes. Sources point here with ON DELETE RESTRICT: a model still in use
    cannot be deleted out from under them.
    """

    __tablename__ = "embedding_models"


    id: Mapped[str] = mapped_column(String(200), primary_key=True)
    author: Mapped[str | None] = mapped_column(String(200))
    downloads: Mapped[int | None] = mapped_column(BigInteger)
    likes: Mapped[int | None] = mapped_column(Integer)
    pipeline_tag: Mapped[str | None] = mapped_column(String(100))
    library_name: Mapped[str | None] = mapped_column(String(100))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    # Absolute path to the snapshot and what it costs on disk. Null until a
    # download completes — these three move together.
    local_path: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DownloadStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class DownloadJob(Base):
    """One attempt at fetching a model repo, and how far it got.

    A download outlives the request that asked for it, so progress lives here
    rather than in memory: the worker writes to this row and callers poll it.
    """

    __tablename__ = "download_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    model_id: Mapped[str] = mapped_column(
        String(200),
        ForeignKey("embedding_models.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[DownloadStatus] = mapped_column(
        Enum(
            DownloadStatus,
            name="download_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=DownloadStatus.QUEUED,
        server_default=DownloadStatus.QUEUED.value,
    )
    # Bytes on disk so far, and what the Hub says the repo weighs. The total is
    # null when the Hub does not report per-file sizes.
    downloaded_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    total_bytes: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_download_jobs_model_id", "model_id"),)

