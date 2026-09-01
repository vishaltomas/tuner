"""Running a flow.

A `.flow` file holds what the user drew: widgets and the wires between them.
This is what decides what that drawing *means* — it compiles the graph into a
LangGraph `StateGraph` and runs it, starting at the workflow's `main.flow`.

Compiling rather than interpreting is the point. Each widget becomes a node
and each wire an edge, so the graph LangGraph executes has the same shape as
the one on screen: widgets on separate branches run concurrently, a widget
with two inputs waits for both, and an Agent widget is a node that runs
another flow as a subgraph.
"""

import logging
from collections.abc import Sequence
from typing import Annotated, Any, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from app.db.session import session_factory
from app.db.sql import sql
from app.services.flows import FlowError, Flows, flows

logger = logging.getLogger(__name__)

# Which wires a widget kind may take, mirroring `WIDGETS` in the frontend's
# `widgets.ts`. `max` is the number that may appear in one flow.
PORTS: dict[str, dict[str, Any]] = {
    "source": {"inputs": False, "outputs": True},
    "agent": {"inputs": True, "outputs": True},
    "system": {"inputs": False, "outputs": True, "max": 1},
    "retrieval": {"inputs": True, "outputs": True, "max": 1},
    "answer": {"inputs": True, "outputs": False, "max": 1},
}

# What a Source widget can stand for.
SOURCE_TYPES = ("files", "txt", "chat")

DEFAULT_TOP_K = 6

# How deep Agent widgets may nest. A flow naming itself — directly or round a
# longer ring — would otherwise recurse until the process died; the visited
# chain below is the precise guard and this is the backstop.
MAX_DEPTH = 8


class WorkflowError(Exception):
    """A flow that cannot be run, with a reason meant for the user."""


def _merge(left: list, right: list) -> list:
    """Combine what branches produced side by side, in order, without repeats.

    Source widgets sit on separate branches and reduce into one list. Two of
    them naming the same source contribute it once: the same passage retrieved
    twice is a passage the model reads twice and cites as two.
    """
    combined: list = []
    for item in [*left, *right]:
        if item not in combined:
            combined.append(item)
    return combined


def _last(_: Any, right: Any) -> Any:
    """Take the newer value. Only one widget of each kind may set these."""
    return right


class FlowState(TypedDict, total=False):
    """What flows between the widgets while a question is answered."""

    question: str
    history: list[tuple[str, str]]
    #: Embedded sources to retrieve from, from `files` Source widgets.
    source_ids: Annotated[list[str], _merge]
    #: Text supplied rather than retrieved — `txt` Source widgets, and whatever
    #: Agent widgets answered.
    notes: Annotated[list[dict], _merge]
    #: Whether a `chat` Source widget put the conversation in front of the model.
    use_history: Annotated[bool, _last]
    system: Annotated[str, _last]
    top_k: Annotated[int, _last]
    answer: str
    citations: list


class Workflow:
    """One flow, compiled and ready to answer questions.

    Built per request: compiling is a walk over a graph with a handful of
    nodes, while the expensive parts it reaches — the tokenizer and the
    embedding weights — are cached behind `NativeRAG.shared`.

    `stack` is the chain of flows that led here, so an Agent widget naming a
    flow already on it is caught as a loop rather than recursing into it.
    """

    def __init__(
        self,
        graph: dict,
        *,
        workflow: str,
        name: str = "main.flow",
        store: Flows | None = None,
        stack: tuple[str, ...] = (),
    ):
        #: The workflow this flow belongs to. An Agent widget names a sibling
        #: file, so a flow can only ever call another in its own workflow —
        #: which is what keeps a workflow a self-contained thing to run.
        self.workflow = workflow
        self.name = name
        self.store = store or flows
        self.stack = (*stack, name)
        self.nodes: dict[str, dict] = {
            node["id"]: node for node in graph.get("nodes", []) if "id" in node
        }
        self.edges: list[dict] = [
            edge
            for edge in graph.get("edges", [])
            if edge.get("source") in self.nodes and edge.get("target") in self.nodes
        ]
        self.answer_id = next(
            (id for id, node in self.nodes.items() if node.get("kind") == "answer"),
            None,
        )
        self.reachable = self._reachable()

    @classmethod
    async def load(
        cls,
        workflow: str,
        name: str = "main.flow",
        *,
        store: Flows | None = None,
        stack: tuple[str, ...] = (),
    ) -> "Workflow":
        """Read a flow off disk and prepare it."""
        store = store or flows
        try:
            graph = await store.read(workflow, name)
        except FlowError as exc:
            raise WorkflowError(str(exc)) from exc
        return cls(graph, workflow=workflow, name=name, store=store, stack=stack)

    def _reachable(self) -> set[str]:
        """Every widget with a path to the Answer widget.

        A widget wired to nothing is one the user dropped and has not connected
        yet; running it would mean a half-built flow behaved as though it were
        finished. Breadth-first over incoming edges, with a `seen` guard so a
        cycle — which the canvas does not prevent — terminates.
        """
        if self.answer_id is None:
            return set()

        seen: set[str] = set()
        queue = [self.answer_id]
        while queue:
            current = queue.pop(0)
            if current in seen:
                continue
            seen.add(current)
            queue.extend(
                edge["source"]
                for edge in self.edges
                if edge["target"] == current and edge["source"] not in seen
            )
        return seen

    def problems(self) -> list[str]:
        """Why this flow cannot answer a question, in the user's terms."""
        if self.answer_id is None:
            return [f"{self.name} has no Answer widget."]

        live = [self.nodes[id] for id in self.reachable]

        for kind, spec in PORTS.items():
            if "max" in spec:
                found = sum(1 for node in live if node.get("kind") == kind)
                if found > spec["max"]:
                    return [f"{self.name} has {found} {kind} widgets; it may have one."]

        feeds = [node for node in live if node.get("kind") in ("source", "agent")]
        if not feeds:
            return [
                f"Nothing feeds the Answer widget in {self.name}; wire a Source "
                f"or an Agent widget into it."
            ]

        for node in feeds:
            config = node.get("config") or {}
            if node.get("kind") == "agent" and not (config.get("flow") or "").strip():
                return [f"An Agent widget in {self.name} names no flow to run."]
            if node.get("kind") == "source":
                source_type = config.get("sourceType") or "files"
                if source_type == "files" and not config.get("sourceId"):
                    return [f"A Source widget in {self.name} has no source picked."]
                if source_type == "txt" and not (config.get("text") or "").strip():
                    return [f"A text Source widget in {self.name} is empty."]
        return []

    async def answer(
        self, question: str, history: Sequence[tuple[str, str]] = ()
    ) -> tuple[str, list]:
        """Run the compiled graph over one question."""
        problems = self.problems()
        if problems:
            raise WorkflowError(problems[0])

        compiled = await self.compile()
        final = await compiled.ainvoke(self._start(question, list(history)))
        return final["answer"], final.get("citations", [])

    @staticmethod
    def _start(question: str, history: list) -> dict:
        """The state a run begins with, here and inside every Agent widget."""
        return {
            "question": question,
            "history": history,
            "source_ids": [],
            "notes": [],
            "use_history": False,
            "system": "",
            "top_k": DEFAULT_TOP_K,
        }

    async def compile(self):
        """Turn the widgets and wires into a LangGraph graph.

        Only reachable widgets are added, so what runs is exactly what the
        canvas shows as connected. Any widget with no incoming wire is entered
        from `START`, which is what lets several Source widgets run at once and
        fan into the Answer widget.

        Async because an Agent widget has to read the flow it names before its
        node can be built.
        """
        builder: StateGraph = StateGraph(FlowState)

        for node_id in self.reachable:
            builder.add_node(node_id, await self._widget(self.nodes[node_id]))

        wired_into: set[str] = set()
        for edge in self.edges:
            if edge["source"] in self.reachable and edge["target"] in self.reachable:
                builder.add_edge(edge["source"], edge["target"])
                wired_into.add(edge["target"])

        for node_id in self.reachable:
            if node_id not in wired_into:
                builder.add_edge(START, node_id)

        builder.add_edge(self.answer_id, END)
        return builder.compile()

    async def _widget(self, node: dict):
        """The function one widget contributes to the run.

        Everything but the Answer widget only announces what it brings; the
        state reducers combine them. The Answer widget is where retrieval and
        generation happen, because it is the only widget that can know the
        whole configuration — it runs last by construction, since every
        reachable widget has a path to it.
        """
        kind = node.get("kind")
        config = node.get("config") or {}

        if kind == "source":
            return self._source_widget(config)
        if kind == "agent":
            return await self._agent_widget(config)
        if kind == "system":
            system = (config.get("system") or "").strip()
            return lambda _state: {"system": system}
        if kind == "retrieval":
            top_k = int(config.get("topK") or DEFAULT_TOP_K)
            return lambda _state: {"top_k": top_k}
        if kind == "answer":
            return self._answer_widget

        raise WorkflowError(f"unknown widget kind: {kind!r}")

    def _source_widget(self, config: dict):
        """A Source widget: an embedded corpus, literal text, or the chat.

        `files` is the only one that reaches the vector store. `txt` and `chat`
        go straight in front of the model, because there is nothing to search —
        a paragraph typed into a widget is already the passage, and the
        conversation is what the user just said.
        """
        source_type = config.get("sourceType") or "files"
        if source_type not in SOURCE_TYPES:
            raise WorkflowError(f"unknown source type: {source_type!r}")

        if source_type == "files":
            source_id = config.get("sourceId")
            ids = [str(source_id)] if source_id else []
            return lambda _state: {"source_ids": ids}

        if source_type == "txt":
            text = (config.get("text") or "").strip()
            label = (config.get("label") or "").strip() or "Note"
            note = [{"label": label, "text": text}] if text else []
            return lambda _state: {"notes": note}

        return lambda _state: {"use_history": True}

    async def _agent_widget(self, config: dict):
        """An Agent widget: another flow, run as a subgraph.

        The named flow answers the same question in its own right, and its
        answer reaches this flow as a passage — so a parent can put a
        specialist's conclusion in front of the model alongside its own
        sources, and the specialist's own wiring stays its own business.
        """
        name = (config.get("flow") or "").strip()
        if not name:
            raise WorkflowError("an Agent widget names no flow to run")
        if name in self.stack:
            raise WorkflowError(
                f"flows call each other in a loop: {' → '.join([*self.stack, name])}"
            )
        if len(self.stack) >= MAX_DEPTH:
            raise WorkflowError(f"flows nest more than {MAX_DEPTH} deep")

        child = await Workflow.load(
            self.workflow, name, store=self.store, stack=self.stack
        )
        problems = child.problems()
        if problems:
            raise WorkflowError(problems[0])

        subgraph = await child.compile()
        label = (config.get("label") or "").strip() or name

        async def run_agent(state: FlowState) -> dict:
            result = await subgraph.ainvoke(
                Workflow._start(state["question"], state.get("history") or [])
            )
            return {"notes": [{"label": label, "text": result["answer"]}]}

        return run_agent

    async def _answer_widget(self, state: FlowState) -> dict:
        """Retrieve and answer, from whatever the upstream widgets collected.

        The embedding model is looked up here rather than passed in: which
        sources are in play is decided by the graph, so the model they share
        cannot be known until the branches have run. They must share one — a
        question is embedded once, and that vector only means anything in the
        space its passages were put in.
        """
        # Deferred: `chat` reaches `native`, which pulls in torch, transformers
        # and unstructured's layout stack. See `main.lifespan`.
        from app.rag.chat import Chat

        source_ids = [UUID(one) for one in state.get("source_ids") or []]
        model = None

        if source_ids:
            async with session_factory() as session:
                rows = (
                    (await session.execute(sql("sources_by_ids"), {"ids": source_ids}))
                    .mappings()
                    .all()
                )

            if set(source_ids) - {row["id"] for row in rows}:
                raise WorkflowError(
                    f"{self.name} points at a source that no longer exists; "
                    f"open it and pick another."
                )
            models = {row["model"] for row in rows}
            if len(models) > 1:
                raise WorkflowError(
                    f"Its sources use different embedding models "
                    f"({', '.join(sorted(models))}); a question can only be "
                    f"asked of one at a time."
                )
            model = models.pop()

        conversation = Chat(
            model,
            source_ids,
            system=state.get("system") or None,
            top_k=state.get("top_k") or DEFAULT_TOP_K,
            notes=state.get("notes") or [],
        )
        reply = await conversation.reply(
            state["question"],
            (state.get("history") or []) if state.get("use_history") else [],
        )
        # Already in marker order — the numbering is the retrieval ranking.
        return {"answer": reply.text, "citations": reply.citations}
