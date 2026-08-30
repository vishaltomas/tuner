"""Answering questions from a source's own passages.

The retrieval half lives in `native.NativeRAG`; this is what turns the
passages it returns into something a person can read — a prompt, a served
model's answer, and the citations that let the answer be checked against the
documents it came from.
"""

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from app.config import settings
from app.services import hf_api

logger = logging.getLogger(__name__)

# What the model is told about the passages, on top of whatever system message
# the user wrote. Their instruction is about tone and task and is theirs to
# change; this is about the shape of the input and is not — an answer that
# ignores the passages, or cites nothing, is not what this pipeline is for.
GROUNDING = """\
You are answering from a numbered set of passages taken from the user's own \
documents, given below. Each is labelled with the document it came from.

Answer only from those passages. Cite every claim with the number of the \
passage it rests on, written in square brackets like [2]; a sentence drawing \
on two passages carries both markers. If the passages do not answer the \
question, say so plainly — do not fall back on what you know generally, and \
do not cite a passage that does not support the point."""

# Offered as the starting text of the system message box in the UI, so the
# user has something to edit rather than an empty field.
DEFAULT_SYSTEM = (
    "You are a careful research assistant. Answer in plain, direct prose, "
    "and prefer the wording of the documents over your own paraphrase when "
    "the distinction matters."
)

# What is said when retrieval comes back empty, instead of asking a model to
# answer from nothing — which is where an invented answer comes from.
NO_PASSAGES = (
    "None of the selected sources have any embedded passages to search yet. "
    "Upload documents to a source and wait for them to finish embedding, then "
    "ask again."
)

# Turns of history kept in front of the model. A chat runs unbounded but a
# prompt cannot, and the retrieved passages are the bulk of what matters.
HISTORY_TURNS = 10


@dataclass(frozen=True, slots=True)
class Citation:
    """One retrieved passage, as the answer refers to it.

    `marker` is the number written into the prompt and, if the model did its
    job, into the answer's square brackets — which is what lets the frontend
    line a claim up with the text it came from.
    """

    marker: int
    chunk_id: UUID
    document_id: UUID
    source_id: UUID
    document_name: str
    pages: list[int]
    score: float
    text: str


@dataclass(frozen=True, slots=True)
class Answer:
    text: str
    citations: list[Citation]


class Chat:
    """One conversation against one set of sources.

    Built per request rather than kept around: the sources, the system message
    and the passage budget are all things the user changes between questions,
    and none of them are expensive to hold. The costly parts — the tokenizer
    and the embedding weights — are cached behind `NativeRAG.shared`.
    """

    def __init__(
        self,
        model: str,
        source_ids: Sequence[UUID],
        *,
        system: str | None = None,
        top_k: int | None = None,
    ):
        self.model = model
        self.source_ids = list(source_ids)
        self.system = (system or "").strip() or DEFAULT_SYSTEM
        self.top_k = top_k or settings.chat_context_chunks

    async def reply(
        self, question: str, history: Sequence[tuple[str, str]] = ()
    ) -> Answer:
        """Retrieve, prompt, and answer.
        """
        from app.rag.native import NativeRAG

        pipeline = await asyncio.to_thread(NativeRAG.shared, self.model)
        rows = await pipeline.query(
            question, num_context_chunks=self.top_k, source_ids=self.source_ids
        )

        if not rows:
            return Answer(text=NO_PASSAGES, citations=[])

        citations = [
            Citation(
                marker=marker,
                chunk_id=row["id"],
                document_id=row["document_id"],
                source_id=row["source_id"],
                document_name=row["document_name"],
                pages=list(row["pages"] or []),
                score=row["score"],
                text=row["text"],
            )
            for marker, row in enumerate(rows, start=1)
        ]

        passages = "\n\n".join(
            f"[{citation.marker}] {citation.document_name}"
            f"{_pages(citation.pages)}\n{citation.text}"
            for citation in citations
        )

        messages = [
            {"role": "system", "content": f"{self.system}\n\n{GROUNDING}"},
            *(
                {"role": role, "content": content}
                for role, content in history[-HISTORY_TURNS:]
            ),
            {
                "role": "user",
                "content": f"Passages:\n\n{passages}\n\nQuestion: {question}",
            },
        ]

        text = await asyncio.to_thread(
            hf_api.chat,
            messages,
            settings.chat_model,
            settings.chat_provider,
            settings.chat_max_tokens,
            settings.chat_temperature,
        )

        if not text:
            raise RuntimeError(
                f"{settings.chat_model} returned an empty answer; "
                f"try a different chat model"
            )

        return Answer(text=text, citations=citations)


def _pages(pages: list[int]) -> str:
    """The page label on a passage, or nothing for a file that has no pages."""
    if not pages:
        return ""
    if len(pages) == 1:
        return f" (p. {pages[0]})"
    return f" (pp. {pages[0]}–{pages[-1]})"
