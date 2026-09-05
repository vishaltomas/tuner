"""The local half of the pipeline: chunking, embedding, retrieval, reranking.

Everything here runs models on this machine against the vectors in Postgres.
What a flow does with the passages — the prompt, the answer — is `chat`; what
decides which of these run and in what order is `workflow`.
"""

import asyncio
import json
import logging
import sqlite3
import threading
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import ClassVar
from uuid import UUID, uuid4

from torch import no_grad
from torch.nn.functional import normalize
from transformers import (
    AutoModel,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedTokenizerBase,
)
from unstructured.documents.elements import Element, Footer, Header, Title
from unstructured.nlp.tokenize import sent_tokenize
from unstructured.partition.pdf import partition_pdf
from unstructured.partition.text import partition_text

from app.config import settings
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

# How strongly MMR penalises a passage for resembling one already picked, and
# how many top-scoring passages it chooses from. The pool is a multiple of the
# budget because the selection is quadratic in its size.
MMR_DIVERSITY = 0.4
MMR_POOL = 5

# Question-and-passage pairs a reranker scores per forward pass, and the pair
# length it was trained on — it truncates rather than stretches, so a long
# passage is scored on its opening.
RERANK_BATCH = 16
RERANK_MAX_TOKENS = 512


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

    # A task holds the only reference to the coroutine driving a pipeline run,
    # and asyncio keeps just a weak one — a run left to itself can be collected
    # mid-flight. Tasks stay in here until they finish.
    _running: ClassVar[set[asyncio.Task]] = set()

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
        # `embed` runs in whatever thread its caller handed it to, and an
        # upload and a question can arrive at once. Without this the two race
        # to build the model and each pays for a copy of the weights.
        self._load_lock = threading.Lock()

    @staticmethod
    @cache
    def shared(model: str) -> "NativeRAG":
        """The pipeline for one embedding model, built once.

        Both halves — storing an upload and answering a question — need the
        weights in memory, and they are hundreds of megabytes. Constructing per
        request would load them per request; the tokenizer behind `Chunking` is
        cached the same way and for the same reason.

        Blocking on first call for a model: callers hand it to a thread.
        """
        return NativeRAG(model)

    @classmethod
    def queue(cls, model: str, documents: Sequence[tuple[UUID, Path]]) -> None:
        """Run the pipeline over an upload, in the background.

        `/embed` answers as soon as the files are on disk and the rows exist —
        chunking and embedding a document takes seconds to minutes, far longer
        than a request should be held open. The documents are marked
        `embedding` by `store` and reach `ready` or `failed` there too, so a
        caller polling `/sources` sees the run without this returning anything.

        Detached, so every failure has to land on a row; anything `store` does
        not already catch is logged here rather than dying silently in a task
        nobody awaits.
        """
        if not documents:
            return

        async def run() -> None:
            try:
                pipeline = await asyncio.to_thread(cls.shared, model)
                await pipeline.store(documents)
            except Exception:
                logger.exception("embedding run for %s failed", model)

        task = asyncio.create_task(run())
        cls._running.add(task)
        task.add_done_callback(cls._running.discard)

    async def store(self, documents: Iterable[tuple[UUID, Path]]) -> dict[UUID, int]:
        """Chunk each document and write its passages, returning the counts.

        A document that cannot be parsed is recorded as failed and the rest go
        on: one corrupt PDF in an upload of fifty should not cost the other
        forty-nine. The failure has to land on the row, because nothing is
        watching this coroutine to be told about it.
        """
        documents = list(documents)
        if not documents:
            return {}

        # Claimed up front rather than per document, so a source shows the
        # whole run as underway instead of one file at a time.
        async with session_factory() as session:
            await session.execute(
                sql("documents_embedding"),
                {"ids": [document_id for document_id, _ in documents]},
            )
            await session.commit()

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
            with self._load_lock:
                # Checked again inside: whoever waited on the lock is looking
                # at a model the holder has already built.
                if self.embedding_model is None:
                    local = storage.model_path(self.model)
                    model = AutoModel.from_pretrained(
                        str(local) if local.is_dir() else self.model
                    )
                    model.eval()
                    self.embedding_model = model

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

    async def query(
        self,
        query_text: str,
        num_context_chunks: int = 10,
        source_ids: Sequence[UUID] | None = None,
        *,
        vector: Sequence[float] | None = None,
        method: str = "similarity",
        diversity: float = MMR_DIVERSITY,
    ) -> list[dict]:
        """The passages closest to a question, nearest first.

        The question is embedded with the same model the passages were, since
        two models put the same sentence in different spaces and a similarity
        across them means nothing. `vector` lets a caller supply that
        embedding — an Embed widget owns it in a flow — so the question is not
        encoded twice when something upstream has already done it.

        `source_ids` narrows the search to chosen sources; without it every
        source using this model is searched. The caller is the one that has to
        have checked those sources share this model: nothing here can tell a
        vector from the wrong space by looking at it.

        The comparison happens here rather than in the store: without pgvector
        there is no cosine operator to order by and no index to serve it, so
        the candidates come back and are scored in process. That is a scan —
        fine for a corpus that fits in memory, and the thing to replace with a
        `vector` column when the extension is available. It is also what lets
        a deployed image search a SQLite file with the same code; see
        `Passages`.
        """
        rows = await Passages().candidates(self.model, source_ids)

        if not rows:
            return []

        if vector is None:
            vector = (await asyncio.to_thread(self.embed, [query_text]))[0]

        # Both sides are already unit length, so the dot product is the cosine.
        scored = [
            (sum(a * b for a, b in zip(vector, row["embedding"], strict=True)), row)
            for row in rows
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)

        if method == "mmr":
            picked = self._mmr(scored, num_context_chunks, diversity)
        else:
            picked = scored[:num_context_chunks]

        return [{**dict(row), "score": score} for score, row in picked]

    @staticmethod
    def _mmr(
        scored: list[tuple[float, dict]], count: int, diversity: float
    ) -> list[tuple[float, dict]]:
        """Maximal marginal relevance: relevant passages that differ.

        Plain top-k answers a question with whichever passages sit closest to
        it, which on a corpus that repeats itself means several near-copies of
        one paragraph and nothing else. MMR picks each next passage for how
        relevant it is *minus* how much it resembles what has already been
        picked, so the budget is spent on distinct material.

        `diversity` is the weight on that penalty: 0 is plain relevance, 1
        ignores relevance entirely.
        """
        # A shortlist, because the pairwise comparison below is quadratic and
        # nothing past the first several dozen was going to be picked anyway.
        pool = scored[: max(count * MMR_POOL, count)]
        picked: list[tuple[float, dict]] = []

        while pool and len(picked) < count:
            best_index, best_value = 0, None
            for index, (relevance, row) in enumerate(pool):
                overlap = max(
                    (
                        sum(
                            a * b
                            for a, b in zip(
                                row["embedding"], chosen["embedding"], strict=True
                            )
                        )
                        for _, chosen in picked
                    ),
                    default=0.0,
                )
                value = (1 - diversity) * relevance - diversity * overlap
                if best_value is None or value > best_value:
                    best_index, best_value = index, value
            picked.append(pool.pop(best_index))

        return picked

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


class Passages:
    """Where retrieval reads its candidate passages from.

    Two stores answer the same question. Postgres is the one this app writes
    to as documents are embedded; a SQLite file is what an exported image
    carries, so a deployment can run with no database to reach. Which one is
    used is a matter of configuration, not of code — everything above this
    reads the same rows either way.
    """

    def __init__(self, path: str | None = None):
        #: The SQLite file to read, or nothing to use Postgres.
        self.path = path if path is not None else settings.vector_db

    async def candidates(
        self, model: str, source_ids: Sequence[UUID] | None
    ) -> list[dict]:
        """Every embedded passage that could answer, before any scoring."""
        if self.path:
            return await asyncio.to_thread(self._sqlite, source_ids)

        statement, params = (
            ("chunks_for_sources", {"source_ids": list(source_ids)})
            if source_ids is not None
            else ("chunks_for_model", {"model": model})
        )
        async with session_factory() as session:
            rows = (await session.execute(sql(statement), params)).mappings().all()
        return [dict(row) for row in rows]

    async def models_for(self, source_ids: Sequence[UUID]) -> dict[UUID, str]:
        """Which model embedded each source, for the ones this store holds.

        A caller compares this against what it expected and reports a source
        that has gone or a set that disagrees; here it is only a lookup. In an
        exported image the answer comes from the file the vectors are in,
        because there is no database to ask.
        """
        if self.path:
            return await asyncio.to_thread(self._sqlite_models, source_ids)

        async with session_factory() as session:
            result = await session.execute(
                sql("sources_by_ids"), {"ids": list(source_ids)}
            )
            return {row["id"]: row["model"] for row in result.mappings()}

    def _sqlite_models(self, source_ids: Sequence[UUID]) -> dict[UUID, str]:
        with sqlite3.connect(f"file:{self.path}?mode=ro", uri=True) as database:
            model = database.execute(
                "SELECT value FROM meta WHERE key = 'model'"
            ).fetchone()
            rows = database.execute("SELECT DISTINCT source_id FROM passages")
            held = {row[0] for row in rows}
        # Every passage in the file was embedded by the one model the export
        # recorded — an image carries a single workflow, and a workflow cannot
        # mix embedding spaces.
        if not model:
            return {}
        return {one: model[0] for one in source_ids if str(one) in held}

    def _sqlite(self, source_ids: Sequence[UUID] | None) -> list[dict]:
        """The same rows, out of the file an exported image was built with.

        Ids and vectors are stored as text: SQLite has neither a UUID type nor
        an array one, and the alternative — a row per dimension, or a blob to
        unpack by hand — would be less legible for no gain at this size.
        """
        wanted = {str(one) for one in source_ids} if source_ids is not None else None

        with sqlite3.connect(self.path) as database:
            database.row_factory = sqlite3.Row
            rows = database.execute("SELECT * FROM passages").fetchall()

        return [
            {
                "id": UUID(row["id"]),
                "document_id": UUID(row["document_id"]),
                "source_id": UUID(row["source_id"]),
                "ordinal": row["ordinal"],
                "text": row["text"],
                "tokens": row["tokens"],
                "pages": json.loads(row["pages"]) if row["pages"] else None,
                "embedding": json.loads(row["embedding"]),
                "document_name": row["document_name"],
            }
            for row in rows
            if wanted is None or row["source_id"] in wanted
        ]


class Reranker:
    """Reordering retrieved passages with a cross-encoder.

    Retrieval scores a passage without ever seeing the question beside it: the
    two are embedded separately and compared as vectors, which is fast enough
    to run over a whole corpus but blunt. A cross-encoder reads the question
    and the passage *together* and scores the pair, which is far better at
    telling a passage that answers the question from one that merely shares
    its vocabulary — and far too slow to run over anything but a shortlist.

    So the two go together: `NativeRAG.query` narrows a corpus to tens of
    passages, and this reorders those.
    """

    @staticmethod
    @cache
    def shared(model: str) -> "Reranker":
        """The reranker for one model id, built once.

        Held the same way `NativeRAG.shared` holds an embedding model, and for
        the same reason: the weights are hundreds of megabytes and a question
        should not pay for loading them.

        Blocking on first call per model; callers hand it to a thread.
        """
        return Reranker(model)

    def __init__(self, model: str):
        self.model = model
        self._tokenizer = None
        self._encoder = None
        # `score` runs in whatever thread its caller handed it to, and two
        # questions can arrive at once. Without this they race to build the
        # model and each pays for a copy of the weights.
        self._load_lock = threading.Lock()

    def score(self, question: str, passages: Sequence[str]) -> list[float]:
        """Relevance of each passage to the question, higher is better.

        The raw logit is returned rather than a probability: nothing here needs
        a calibrated number, only an ordering, and squashing it through a
        sigmoid would lose the spread that makes near-ties visible.

        Blocking and CPU-bound; callers hand it to a thread.
        """
        if not passages:
            return []

        if self._encoder is None:
            with self._load_lock:
                # Checked again inside: whoever waited on the lock is looking
                # at a model the holder has already built.
                if self._encoder is None:
                    local = storage.model_path(self.model)
                    source = str(local) if local.is_dir() else self.model
                    self._tokenizer = AutoTokenizer.from_pretrained(source)
                    encoder = AutoModelForSequenceClassification.from_pretrained(source)
                    encoder.eval()
                    self._encoder = encoder

        scores: list[float] = []
        for start in range(0, len(passages), RERANK_BATCH):
            batch = list(passages[start : start + RERANK_BATCH])
            encoded = self._tokenizer(
                [question] * len(batch),
                batch,
                padding=True,
                truncation=True,
                max_length=RERANK_MAX_TOKENS,
                return_tensors="pt",
            )
            with no_grad():
                logits = self._encoder(**encoded).logits
            # A cross-encoder trained for ranking has one output; one trained
            # as a classifier has two, where the second is "relevant".
            column = logits[:, -1] if logits.shape[-1] > 1 else logits.squeeze(-1)
            scores.extend(column.tolist())

        return scores
