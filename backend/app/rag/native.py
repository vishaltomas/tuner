"""
RAG module
"""

import asyncio
import logging
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from uuid import UUID, uuid4

from torch import no_grad
from torch.nn.functional import normalize
from transformers import AutoModel, AutoTokenizer, PreTrainedTokenizerBase
from unstructured.documents.elements import Element, Footer, Header, Title
from unstructured.nlp.tokenize import sent_tokenize
from unstructured.partition.pdf import partition_pdf
from unstructured.partition.text import partition_text

from app.db.models import DocumentKind, DocumentStatus
from app.db.session import session_factory
from app.db.sql import sql
from app.services import storage

logger = logging.getLogger(__name__)

# Used when a tokenizer does not say what it can take. Most sentence-embedding
# models stop at 512, and `model_max_length` is a sentinel of about 1e30 on the
# ones that decline to answer, so a bare `min()` against it is not enough.
DEFAULT_MAX_TOKENS = 512
MAX_TOKENS_SENTINEL = 100_000

# Sentences repeated from the end of one chunk at the start of the next, so a
# passage that straddles a cut is whole on one side of it. 0 repeats nothing.
OVERLAP_SENTENCES = 1

# Text extraction from pdf
PDF_STRATEGY = "fast"

# Passages per forward pass; a batch pads to its longest member.
EMBED_BATCH = 32


@dataclass(frozen=True, slots=True)
class Chunk:
    """One passage, ready to be embedded.

    `document` and `index` are what tie a vector back to the row it came from
    and the order it appeared in; `pages` is what a citation is rendered from.
    `tokens` is the measured length, so nothing downstream has to re-encode the
    text to find out whether it fits.
    """

    document: Path
    index: int
    text: str
    pages: set[int]
    tokens: int


class Chunking:
    """Splits a source's documents into passages its embedding model can take.

    Built once per source: every document in one shares a model, and a split is
    only correct for the tokenizer that measured it.
    """

    @staticmethod
    @cache
    def tokenizer(model: str) -> PreTrainedTokenizerBase:
        """
        Loading tokenizer
        """
        local = storage.model_path(model)
        return AutoTokenizer.from_pretrained(str(local) if local.is_dir() else model)

    def __init__(
        self,
        model: str,
        max_tokens: int | None = None,
        overlap_sentences: int = OVERLAP_SENTENCES,
    ):
        if overlap_sentences < 0:
            raise ValueError("overlap_sentences cannot be negative")
        self.overlap_sentences = overlap_sentences
        self.model = model
        self._tokenizer = self.tokenizer(model)
        if not self._tokenizer.is_fast:
            # fast tokens provide span of each tokens
            raise ValueError(f"{model!r} has no fast tokenizer; cannot chunk with it")

        if max_tokens is None:
            limit = getattr(self._tokenizer, "model_max_length", None)
            if not limit or limit > MAX_TOKENS_SENTINEL:
                limit = DEFAULT_MAX_TOKENS
            max_tokens = max(1, limit - self._tokenizer.num_special_tokens_to_add())

        self.max_tokens = max_tokens

    async def chunk_documents(self, paths: Iterable[Path]) -> list[Chunk]:
        """Chunk each document, in document order.

        Parsing a PDF is CPU-bound and runs for seconds, so each document is
        handed to a thread rather than parsed on the event loop. They go one at
        a time: the parsers hold a whole file in memory, and a source can be a
        hundred of them.
        """
        chunks: list[Chunk] = []
        for path in paths:
            chunks.extend(await asyncio.to_thread(self.chunk_document, path))
        return chunks

    def chunk_document(self, path: Path) -> list[Chunk]:
        """Parse one file and split it into passages — the blocking half.

        Uploads are named `<document id>.<kind>` by `services.storage`, so the
        suffix is the kind the row records. `partition.auto` would sniff the
        file instead, but it dispatches to every parser `unstructured` ships;
        naming the two kinds this app accepts keeps an unexpected file an error
        here rather than a surprise parse.

        A `Title` starts a section, and each section is split on its own, so a
        passage never runs from the end of one topic into the start of the
        next: two sections that happen to sit either side of a boundary have
        nothing to do with each other, and a vector covering both answers for
        neither. Within a section the elements are joined into one string, so a
        heading stays with the text underneath it rather than becoming a chunk
        of its own, and the split has a single string to cut.
        """
        try:
            kind = DocumentKind(path.suffix.lstrip(".").lower())
        except ValueError:
            raise ValueError(
                f"cannot chunk {path.name!r}: expected a .pdf or .txt file"
            ) from None

        elements: Sequence[Element]
        if kind is DocumentKind.PDF:
            elements = partition_pdf(filename=str(path), strategy=PDF_STRATEGY)
        else:
            elements = partition_text(filename=str(path))

        # A section is its sentences, each carrying the page of the element it
        # came from. Nothing tracks character positions: a chunk is built by
        # joining sentences, not by slicing them back out of a string.
        sections: list[list[tuple[str, int | None]]] = []
        section: list[tuple[str, int | None]] = []

        for element in elements:
            if isinstance(element, (Header, Footer)):
                continue
            body = element.text.strip()
            if not body:
                continue
            if isinstance(element, Title) and section:
                sections.append(section)
                section = []
            page = element.metadata.page_number
            section.extend((sentence, page) for sentence in sent_tokenize(body))

        if section:
            sections.append(section)

        chunks: list[Chunk] = []
        for section in sections:
            for text, pages, tokens in self._split(section):
                chunks.append(
                    Chunk(
                        document=path,
                        index=len(chunks),
                        text=text,
                        pages=pages,
                        tokens=tokens,
                    )
                )

        return chunks

    def _split(
        self, section: Sequence[tuple[str, int | None]]
    ) -> Iterator[tuple[str, set[int], int]]:
        """Pack one section's sentences into chunks of at most `max_tokens`.

        Sentences are added until the next one would not fit; the chunk closes
        there and a new one starts. A chunk therefore holds whole sentences —
        one cut part way through reads as a fragment and embeds as one — and
        never carries past the end of its section.
        """
        kept: list[tuple[str, int | None, int]] = []
        tokens = 0

        for sentence, page in section:
            # Strays: a bullet marker left behind by the parser, a rule, a
            # stripe of punctuation. They cost a token and say nothing.
            if not any(character.isalnum() for character in sentence):
                continue

            cost = len(self._tokenizer.encode(sentence, add_special_tokens=False))

            if kept and tokens + cost > self.max_tokens:
                yield (
                    " ".join(text for text, _, _ in kept),
                    {page for _, page, _ in kept if page is not None},
                    tokens,
                )
                kept = (
                    kept[len(kept) - self.overlap_sentences :]
                    if self.overlap_sentences
                    else []
                )
                tokens = sum(carried for _, _, carried in kept)
                if tokens + cost > self.max_tokens:
                    kept, tokens = [], 0

            kept.append((sentence, page, cost))
            tokens += cost

        if kept:
            yield (
                " ".join(text for text, _, _ in kept),
                {page for _, page, _ in kept if page is not None},
                tokens,
            )


class NativeRAG:
    """
    Native RAG Pipeline:
    Document Processing : Extract the contents from documents -> Chunks ->
                    Store it in DB
    Query Processing: Embed the query first and then a cosine similarity search. Return
                    the number of specified chunks
    """

    def __init__(
        self,
        model: str,
        *,
        max_tokens: int | None = None,
        overlap_sentences: int = OVERLAP_SENTENCES,
    ):
        self.model = model
        self.chunking = Chunking(
            model, max_tokens=max_tokens, overlap_sentences=overlap_sentences
        )
        self.embedding_model = None

    async def store(self, documents: Iterable[tuple[UUID, Path]]) -> dict[UUID, int]:
        """Chunk each document and write its passages, returning the counts.

        A document that cannot be parsed is recorded as failed and the rest go
        on: one corrupt PDF in an upload of fifty should not cost the other
        forty-nine. The failure has to land on the row, because nothing is
        watching this coroutine to be told about it.
        """
        stored: dict[UUID, int] = {}

        for document_id, path in documents:
            try:
                chunks = await self.chunking.chunk_documents([path])
            except Exception as exc:
                logger.warning("chunking %s failed", path.name, exc_info=True)
                await self._pgsql_connector(
                    document_id, (), error=f"{type(exc).__name__}: {exc}"[:2000]
                )
                continue

            if not chunks:
                await self._pgsql_connector(
                    document_id,
                    (),
                    error="no text could be extracted; the file may be scanned",
                )
                continue

            vectors = await asyncio.to_thread(
                self.embed, [chunk.text for chunk in chunks]
            )
            await self._pgsql_connector(document_id, chunks, vectors)
            stored[document_id] = len(chunks)

        return stored

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Encode passages with the source's model, one vector each.

        Mean pooling over the token vectors, masked so padding contributes
        nothing, then L2 normalised — which is what sentence-transformers
        models are trained to be compared as, and what lets a cosine
        similarity be computed later as a plain dot product.

        Blocking and CPU-bound; callers hand it to a thread.
        """
        if self.embedding_model is None:
            local = storage.model_path(self.model)
            self.embedding_model = AutoModel.from_pretrained(
                str(local) if local.is_dir() else self.model
            )
            self.embedding_model.eval()

        tokenizer = Chunking.tokenizer(self.model)
        vectors: list[list[float]] = []

        for start in range(0, len(texts), EMBED_BATCH):
            batch = tokenizer(
                list(texts[start : start + EMBED_BATCH]),
                padding=True,
                # Passages are built to fit, but a query is whatever was typed.
                truncation=True,
                return_tensors="pt",
            )
            with no_grad():
                hidden = self.embedding_model(**batch).last_hidden_state
            mask = batch["attention_mask"].unsqueeze(-1).to(hidden.dtype)
            pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
            vectors.extend(normalize(pooled, p=2.0, dim=1).tolist())

        return vectors

    async def query(self, query_text: str, num_context_chunks: int = 10) -> list[dict]:
        """The passages closest to a question, nearest first.

        The question is embedded with the same model the passages were, since
        two models put the same sentence in different spaces and a similarity
        across them means nothing. Only sources using this model are searched.

        The comparison happens here rather than in Postgres: without pgvector
        there is no cosine operator to order by and no index to serve it, so
        the candidates come back and are scored in process. That is a scan —
        fine for a corpus that fits in memory, and the thing to replace with a
        `vector` column when the extension is available.
        """
        async with session_factory() as session:
            rows = (
                (await session.execute(sql("chunks_for_model"), {"model": self.model}))
                .mappings()
                .all()
            )

        if not rows:
            return []

        vector = (await asyncio.to_thread(self.embed, [query_text]))[0]
        # Both sides are already unit length, so the dot product is the cosine.
        scored = [
            (sum(a * b for a, b in zip(vector, row["embedding"], strict=True)), row)
            for row in rows
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)

        return [
            {**dict(row), "score": score} for score, row in scored[:num_context_chunks]
        ]

    async def _pgsql_connector(
        self,
        document_id: UUID,
        chunks: Sequence[Chunk],
        vectors: Sequence[Sequence[float]] = (),
        error: str | None = None,
    ) -> None:
        """Write one document's chunking outcome, on a session of its own.

        The delete is what makes chunking repeatable: passages are replaced
        rather than added to, so running again after a crash — or after the
        budget changed — cannot leave the two runs interleaved. It and the
        insert share a transaction, so a document is never briefly empty.

        The status reaches `ready` here because the vectors are written with
        the passages: `ready` claims a document can be searched, and once its
        embeddings are in the table that is true.
        """
        async with session_factory() as session:
            await session.execute(
                sql("chunks_delete_for_document"), {"document_id": document_id}
            )

            if chunks:
                # One statement, many parameter sets: the driver batches these
                # rather than making a round trip per passage.
                await session.execute(
                    sql("chunk_create"),
                    [
                        {
                            "id": uuid4(),
                            "document_id": document_id,
                            "ordinal": chunk.index,
                            "text": chunk.text,
                            "tokens": chunk.tokens,
                            "pages": sorted(chunk.pages) or None,
                            "embedding": vector,
                        }
                        for chunk, vector in zip(chunks, vectors, strict=True)
                    ],
                )

            await session.execute(
                sql("document_processed"),
                {
                    "id": document_id,
                    "status": (
                        DocumentStatus.FAILED if error else DocumentStatus.READY
                    ).value,
                    # A count on a failed run would be a claim about work that
                    # did not finish.
                    "chunks": None if error else len(chunks),
                    "error": error,
                },
            )
            await session.commit()
