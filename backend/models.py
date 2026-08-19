import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


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
    model: Mapped[str] = mapped_column(String(200), nullable=False)
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

    documents: Mapped[list["SourceDocument"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        # Sources are always read with their documents; one query, not N.
        lazy="selectin",
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
