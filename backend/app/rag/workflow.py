"""Running a flow.

A `.flow` file holds what the user drew: widgets and the wires between them.
This is what decides what that drawing *means* — it compiles the graph into a
LangGraph `StateGraph` and runs it, starting at the workflow's `main.flow`.

Compiling rather than interpreting is the point. Each widget becomes a node
and each wire an edge, so the graph LangGraph executes has the same shape as
the one on screen: widgets on separate branches run concurrently, a widget
with two inputs waits for both, and an Agent widget is a node that runs
another flow as a subgraph.

A run enters at the Input widget and leaves at the Output widget. In
`main.flow` both are the chat — the question arrives at one and the answer
leaves from the other — and in a called flow they are a typed payload, so an
Agent widget hands text in and gets text back.
"""

import asyncio
import logging
import re
from collections.abc import Sequence
from typing import Annotated, Any, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from app.config import settings
from app.services import hf_api
from app.services.flows import MAIN, FlowError, Flows, flows

logger = logging.getLogger(__name__)

# Which wires a widget kind may take, mirroring `WIDGETS` in the frontend's
# `widgets.ts`. `max` is the number that may appear in one flow.
PORTS: dict[str, dict[str, Any]] = {
    "input": {"inputs": False, "outputs": True, "max": 1},
    "source": {"inputs": True, "outputs": True},
    "embed": {"inputs": True, "outputs": True, "max": 1},
    "reranker": {"inputs": True, "outputs": True, "max": 1},
    "router": {"inputs": True, "outputs": True},
    "agent": {"inputs": True, "outputs": True},
    "system": {"inputs": False, "outputs": True, "max": 1},
    "output": {"inputs": True, "outputs": False, "max": 1},
}

# What a Source widget can stand for.
SOURCE_TYPES = ("files", "txt", "chat")

# How a `files` Source picks its passages.
RETRIEVAL_METHODS = ("similarity", "mmr")

# What an Input or Output widget carries. `chat` is the conversation itself,
# which is what `main.flow` is wired to; a payload is text with a declared
# extension, which is how a called flow takes and returns its work.
IO_MODES = ("chat", "payload")
PAYLOAD_TYPES = ("txt", "md", "json", "csv", "html")

DEFAULT_DOCS = 6

# How deep Agent widgets may nest. A flow naming itself — directly or round a
# longer ring — would otherwise recurse until the process died; the visited
# chain below is the precise guard and this is the backstop.
MAX_DEPTH = 8


class WorkflowError(Exception):
    """A flow that cannot be run, with a reason meant for the user."""


def _merge(left: list, right: list) -> list:
    """Combine what branches produced side by side, in order, without repeats.

    Widgets on separate branches reduce into one list. Two Source widgets
    naming the same source contribute it once: the same passage retrieved
    twice is a passage the model reads twice and cites as two.
    """
    combined: list = []
    seen: set = set()
    for item in [*left, *right]:
        key = item.get("id") if isinstance(item, dict) else item
        marker = str(key) if key is not None else repr(item)
        if marker in seen:
            continue
        seen.add(marker)
        combined.append(item)
    return combined


def _merge_dict(left: dict, right: dict) -> dict:
    """Combine what each Router decided. One key per Router, so they cannot
    tread on each other when a flow has more than one."""
    return {**left, **right}


def _last(_: Any, right: Any) -> Any:
    """Take the newer value. Only one widget of each kind may set these."""
    return right


class FlowState(TypedDict, total=False):
    """What flows between the widgets while one run happens."""

    #: What was asked. The chat message in `main.flow`, the payload text in a
    #: called flow — the widgets downstream cannot tell the difference.
    question: str
    history: list[tuple[str, str]]
    #: The question as a vector, set by the Embed widget, and the model that
    #: made it. A Source widget retrieves against these.
    vector: Annotated[list[float] | None, _last]
    embed_model: Annotated[str | None, _last]
    #: Passages retrieved by Source widgets, merged across branches.
    passages: Annotated[list[dict], _merge]
    #: Chunk ids in the order the Reranker put them, and what it scored them.
    #: Applied by the Output widget rather than reordering `passages` in place,
    #: because the merge reducer above collects them and appends rather than
    #: replaces.
    order: Annotated[list[str], _last]
    rerank: Annotated[dict[str, float], _last]
    #: Text supplied rather than retrieved — `txt` Source widgets, and
    #: whatever Agent widgets answered.
    notes: Annotated[list[dict], _merge]
    #: What each Router chose, keyed by the Router's own widget id.
    routes: Annotated[dict[str, str], _merge_dict]
    #: Whether a `chat` Source widget put the conversation in front of the model.
    use_history: Annotated[bool, _last]
    system: Annotated[str, _last]
    answer: str
    citations: list


class Workflow:
    """One flow, compiled and ready to run.

    Built per request: compiling is a walk over a graph with a handful of
    nodes, while the expensive parts it reaches — tokenizers, embedding
    weights, cross-encoders — are cached behind their own `shared` accessors.

    `stack` is the chain of flows that led here, so an Agent widget naming a
    flow already on it is caught as a loop rather than recursing into it.
    """

    def __init__(
        self,
        graph: dict,
        *,
        workflow: str,
        name: str = MAIN,
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
        self.output_id = self._only("output")
        self.input_id = self._only("input")
        self.reachable = self._reachable()

    def _only(self, kind: str) -> str | None:
        return next(
            (id for id, node in self.nodes.items() if node.get("kind") == kind), None
        )

    @classmethod
    async def load(
        cls,
        workflow: str,
        name: str = MAIN,
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
        """Every widget with a path to the Output widget.

        A widget wired to nothing is one the user dropped and has not connected
        yet; running it would mean a half-built flow behaved as though it were
        finished. Breadth-first over incoming edges, with a `seen` guard so a
        cycle — which the canvas does not prevent — terminates.
        """
        if self.output_id is None:
            return set()

        seen: set[str] = set()
        queue = [self.output_id]
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
        """Why this flow cannot run, in the user's terms."""
        if self.input_id is None:
            return [f"{self.name} has no Input widget — a run has to start somewhere."]
        if self.output_id is None:
            return [f"{self.name} has no Output widget — a run has to end somewhere."]
        if self.input_id not in self.reachable:
            return [
                f"The Input widget in {self.name} is not wired to the Output widget."
            ]

        live = [self.nodes[id] for id in self.reachable]

        for kind, spec in PORTS.items():
            if "max" in spec:
                found = sum(1 for node in live if node.get("kind") == kind)
                if found > spec["max"]:
                    return [f"{self.name} has {found} {kind} widgets; it may have one."]

        # `main.flow` is what Chat runs, so its two ends are the conversation.
        if self.name == MAIN:
            for id, what in ((self.input_id, "Input"), (self.output_id, "Output")):
                mode = (self.nodes[id].get("config") or {}).get("mode") or "chat"
                if mode != "chat":
                    return [
                        f"The {what} widget in main.flow must be set to Chat — it is "
                        f"where the conversation enters and leaves."
                    ]

        sources = [node for node in live if node.get("kind") == "source"]
        embed = next((node for node in live if node.get("kind") == "embed"), None)
        retrieving = [
            node
            for node in sources
            if ((node.get("config") or {}).get("sourceType") or "files") == "files"
        ]

        for node in live:
            config = node.get("config") or {}
            kind = node.get("kind")

            if kind == "agent" and not (config.get("flow") or "").strip():
                return [f"An Agent widget in {self.name} names no flow to run."]

            if kind == "reranker" and not (config.get("model") or "").strip():
                return [f"The Reranker widget in {self.name} names no model."]

            if kind == "router":
                routes = config.get("routes") or []
                if len(routes) < 2:
                    return [
                        f"A Router widget in {self.name} needs at least two "
                        f"routes — with one there is nothing to decide."
                    ]
                if any(not (route.get("when") or "").strip() for route in routes):
                    return [
                        f"A route on a Router widget in {self.name} does not "
                        f"say when to take it."
                    ]
                wired = {
                    edge.get("sourceHandle")
                    for edge in self.edges
                    if edge["source"] == node["id"] and edge["target"] in self.reachable
                }
                loose = [
                    route.get("label") or route["id"]
                    for route in routes
                    if route["id"] not in wired
                ]
                if loose:
                    return [
                        f"Route{'s' if len(loose) > 1 else ''} "
                        f"{', '.join(loose)} on a Router widget in {self.name} "
                        f"{'lead' if len(loose) > 1 else 'leads'} nowhere; "
                        f"wire {'them' if len(loose) > 1 else 'it'} onward."
                    ]

            if kind == "source":
                source_type = config.get("sourceType") or "files"
                if source_type == "files" and not config.get("sourceIds"):
                    return [f"A Source widget in {self.name} has no sources picked."]
                if source_type == "txt" and not (config.get("text") or "").strip():
                    return [f"A text Source widget in {self.name} is empty."]

        if retrieving and embed is None:
            return [
                f"A Source widget in {self.name} retrieves from embedded files, so "
                f"wire an Embed widget into it — that is what turns the question "
                f"into a vector to search with."
            ]

        feeds = [
            node for node in live if node.get("kind") in ("source", "agent", "input")
        ]
        if not any(node.get("kind") in ("source", "agent") for node in feeds):
            return [
                f"Nothing feeds the Output widget in {self.name}; wire a Source or "
                f"an Agent widget into it."
            ]
        return []

    async def run(
        self, question: str, history: Sequence[tuple[str, str]] = ()
    ) -> tuple[str, list]:
        """Run the compiled graph once."""
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
            "vector": None,
            "embed_model": None,
            "passages": [],
            "order": [],
            "notes": [],
            "use_history": False,
            "system": "",
            "rerank": {},
            "routes": {},
        }

    async def compile(self):
        """Turn the widgets and wires into a LangGraph graph.

        Only reachable widgets are added, so what runs is exactly what the
        canvas shows as connected. Any widget with no incoming wire is entered
        from `START`, which is what lets several branches run at once and fan
        into the Output widget.

        Async because an Agent widget has to read the flow it names before its
        node can be built.
        """
        builder: StateGraph = StateGraph(FlowState)

        for node_id in self.reachable:
            builder.add_node(node_id, await self._widget(self.nodes[node_id]))

        routers = {
            id for id in self.reachable if self.nodes[id].get("kind") == "router"
        }

        wired_into: set[str] = set()
        for edge in self.edges:
            if edge["source"] not in self.reachable:
                continue
            if edge["target"] not in self.reachable:
                continue
            wired_into.add(edge["target"])
            # A Router's wires are added below as one conditional edge, not
            # here: adding them plainly would run every branch, which is the
            # opposite of routing.
            if edge["source"] not in routers:
                builder.add_edge(edge["source"], edge["target"])

        for router_id in routers:
            self._route_edges(builder, router_id)

        for node_id in self.reachable:
            if node_id not in wired_into:
                builder.add_edge(START, node_id)

        builder.add_edge(self.output_id, END)
        return builder.compile()

    def _route_edges(self, builder: StateGraph, router_id: str) -> None:
        """Wire one Router's outgoing branches as a conditional edge.

        LangGraph runs whatever a conditional edge returns and nothing else, so
        the branches not chosen never execute — which is what makes this a
        router rather than another fan-out.
        """
        targets: dict[str, str] = {}
        for edge in self.edges:
            if edge["source"] != router_id or edge["target"] not in self.reachable:
                continue
            targets[edge.get("sourceHandle") or edge["target"]] = edge["target"]

        if not targets:
            raise WorkflowError(
                f"A Router widget in {self.name} is wired to nothing; a route "
                f"has to lead somewhere."
            )

        fallback = next(iter(targets.values()))

        def choose(state: FlowState) -> str:
            # An unknown or missing choice takes the first route rather than
            # stalling: the run has already cost a retrieval, and answering
            # from one branch beats answering from none.
            return targets.get((state.get("routes") or {}).get(router_id), fallback)

        builder.add_conditional_edges(router_id, choose, sorted(set(targets.values())))

    async def _widget(self, node: dict):
        """The function one widget contributes to the run."""
        kind = node.get("kind")
        config = node.get("config") or {}

        if kind == "input":
            # The question is already in the state a run starts with; this
            # widget is where that entry is drawn, and the wire out of it is
            # what makes the order of everything downstream explicit.
            return lambda _state: {}
        if kind == "system":
            system = (config.get("system") or "").strip()
            return lambda _state: {"system": system}
        if kind == "embed":
            return self._embed_widget(config)
        if kind == "source":
            return self._source_widget(config)
        if kind == "reranker":
            return self._reranker_widget(config)
        if kind == "router":
            return self._router_widget(node["id"], config)
        if kind == "agent":
            return await self._agent_widget(config)
        if kind == "output":
            return self._output_widget(config)

        raise WorkflowError(f"unknown widget kind: {kind!r}")

    def _embed_widget(self, config: dict):
        """The Embed widget: the question, as a vector.

        Owning this explicitly is what lets a flow say which space it searches
        in. It has to be the space the passages were put in — a vector from one
        model means nothing against passages embedded by another.

        Left blank it uses whatever model this flow's Source widgets were
        embedded with, which is the only answer that can be right. Naming one
        is for saying so deliberately, and for a flow whose sources are not
        decided here.
        """
        named = (config.get("model") or "").strip()

        async def run_embed(state: FlowState) -> dict:
            from app.rag.native import NativeRAG

            model = named or await self._source_model()
            if not model:
                raise WorkflowError(
                    f"The Embed widget in {self.name} has no model, and its "
                    f"Source widgets name none to borrow — pick one."
                )
            pipeline = await asyncio.to_thread(NativeRAG.shared, model)
            vector = (await asyncio.to_thread(pipeline.embed, [state["question"]]))[0]
            return {"vector": vector, "embed_model": model}

        return run_embed

    async def _source_model(self) -> str | None:
        """The model this flow's own `files` Source widgets were embedded with."""
        wanted: list[UUID] = []
        for id in self.reachable:
            node = self.nodes[id]
            config = node.get("config") or {}
            if node.get("kind") != "source":
                continue
            if (config.get("sourceType") or "files") != "files":
                continue
            wanted.extend(UUID(str(one)) for one in config.get("sourceIds") or [])

        if not wanted:
            return None
        return await self._model_for(wanted, None)

    def _source_widget(self, config: dict):
        """A Source widget: embedded files, literal text, or the chat.

        `files` is the only one that reaches the vector store, and it may name
        several sources — they are searched together, as one pool, so the
        budget is spent on the best passages across all of them rather than a
        fixed share from each.

        `txt` and `chat` go straight in front of the model, because there is
        nothing to search: a paragraph typed into a widget is already the
        passage, and the conversation is what the user just said.
        """
        source_type = config.get("sourceType") or "files"
        if source_type not in SOURCE_TYPES:
            raise WorkflowError(f"unknown source type: {source_type!r}")

        if source_type == "txt":
            text = (config.get("text") or "").strip()
            label = (config.get("label") or "").strip() or "Note"
            note = [{"id": f"note:{label}:{hash(text)}", "label": label, "text": text}]
            return lambda _state: {"notes": note if text else []}

        if source_type == "chat":
            return lambda _state: {"use_history": True}

        source_ids = [UUID(str(one)) for one in config.get("sourceIds") or []]
        method = config.get("method") or "similarity"
        if method not in RETRIEVAL_METHODS:
            raise WorkflowError(f"unknown retrieval method: {method!r}")
        count = int(config.get("docs") or DEFAULT_DOCS)

        async def run_source(state: FlowState) -> dict:
            # Deferred: `native` pulls in torch, transformers and
            # unstructured's layout stack. See `main.lifespan`.
            from app.rag.native import NativeRAG

            model = await self._model_for(source_ids, state.get("embed_model"))
            pipeline = await asyncio.to_thread(NativeRAG.shared, model)
            rows = await pipeline.query(
                state["question"],
                num_context_chunks=count,
                source_ids=source_ids,
                vector=state.get("vector"),
                method=method,
            )
            return {"passages": [{**row, "id": str(row["id"])} for row in rows]}

        return run_source

    async def _model_for(
        self, source_ids: Sequence[UUID], embed_model: str | None
    ) -> str:
        """The embedding model these sources share, checked against the Embed widget.

        A question is embedded once, and that vector only means anything in the
        space its passages were put in — so the sources must agree with each
        other and with whatever the Embed widget used.
        """
        # Through the passage store rather than the database directly: an
        # exported image has no database, and its vectors carry the model that
        # made them. See `Passages`.
        from app.rag.native import Passages

        known = await Passages().models_for(source_ids)

        if set(source_ids) - set(known):
            raise WorkflowError(
                f"{self.name} points at a source that no longer exists; "
                f"open it and pick another."
            )

        models = set(known.values())
        if len(models) > 1:
            raise WorkflowError(
                f"A Source widget in {self.name} mixes embedding models "
                f"({', '.join(sorted(models))}); a question can only be asked "
                f"of one at a time."
            )
        model = models.pop()

        if embed_model and embed_model != model:
            raise WorkflowError(
                f"The Embed widget uses {embed_model} but its sources were "
                f"embedded with {model}; a vector from one model means nothing "
                f"against passages from another."
            )
        return model

    def _reranker_widget(self, config: dict):
        """The Reranker widget: the shortlist, reordered by a cross-encoder.

        It writes the ordering rather than the passages. `passages` is merged
        across branches by a reducer that appends, so a node writing a
        reordered copy would add them all again; the Output widget applies
        this instead.
        """
        model = (config.get("model") or "").strip()
        keep = config.get("keep")
        keep = int(keep) if keep else None

        async def run_reranker(state: FlowState) -> dict:
            from app.rag.native import Reranker

            passages = state.get("passages") or []
            if not passages:
                return {}

            reranker = await asyncio.to_thread(Reranker.shared, model)
            scores = await asyncio.to_thread(
                reranker.score, state["question"], [one["text"] for one in passages]
            )
            ranked = sorted(
                zip(passages, scores, strict=True),
                key=lambda pair: pair[1],
                reverse=True,
            )
            if keep:
                ranked = ranked[:keep]
            return {
                "order": [one["id"] for one, _ in ranked],
                "rerank": {one["id"]: score for one, score in ranked},
            }

        return run_reranker

    def _router_widget(self, node_id: str, config: dict):
        """A Router widget: one branch taken, the rest skipped.

        A small model is asked which route the question belongs to. It is the
        cheapest useful thing an LLM can do here — a one-token classification
        — and naming the model is a property of the widget, because the model
        that answers well is rarely the one worth spending on a decision this
        small.
        """
        routes = list(config.get("routes") or [])
        model = (config.get("model") or "").strip() or settings.chat_model
        listing = "\n".join(
            f"{index}. {route.get('label') or route['id']} — {route.get('when') or ''}"
            for index, route in enumerate(routes, start=1)
        )

        async def run_router(state: FlowState) -> dict:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You route a question to exactly one handler. Reply "
                        "with the number of the best handler and nothing else "
                        "— no punctuation, no explanation."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Handlers:\n{listing}\n\n"
                        f"Question: {state['question']}\n\n"
                        f"Number:"
                    ),
                },
            ]
            reply = await asyncio.to_thread(
                hf_api.chat, messages, model, settings.chat_provider, 8, 0.0
            )

            # The reply is a number, but a model that has been asked for one
            # will sometimes wrap it in a word. The first integer in range is
            # taken; anything else falls back to the first route, which is why
            # the order the user put them in matters.
            picked = routes[0]
            for token in re.findall(r"\d+", reply or ""):
                index = int(token)
                if 1 <= index <= len(routes):
                    picked = routes[index - 1]
                    break

            logger.info(
                "router %s in %s chose %s", node_id, self.name, picked.get("label")
            )
            return {"routes": {node_id: picked["id"]}}

        return run_router

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
            answer = result["answer"]
            return {
                "notes": [
                    {"id": f"agent:{name}", "label": label, "text": answer}
                ]
            }

        return run_agent

    def _output_widget(self, config: dict):
        """The Output widget: where the run ends.

        In `main.flow` this is the chat — the passages collected upstream are
        put in front of the model and the answer goes back to the pane. In a
        called flow it is a payload, which is the same answer handed to the
        Agent widget that asked for it, labelled with the extension the user
        chose so a caller can see what kind of text it is.
        """
        mode = config.get("mode") or "chat"
        payload_type = config.get("payloadType") or "txt"

        async def run_output(state: FlowState) -> dict:
            from app.rag.chat import Chat

            passages = state.get("passages") or []
            order = state.get("order") or []
            if order:
                # The Reranker's ordering, applied here. Anything it dropped
                # is dropped: `keep` is a budget, not a suggestion.
                #
                # Its score replaces the retrieval one too. Leaving the cosine
                # on a list the cross-encoder reordered shows numbers that do
                # not descend, which reads as a bug rather than as two
                # different measurements.
                position = {id: index for index, id in enumerate(order)}
                rerank = state.get("rerank") or {}
                passages = [
                    {
                        **one,
                        "score": rerank.get(one["id"], one["score"]),
                        "score_kind": "rerank",
                    }
                    for one in sorted(
                        (one for one in passages if one["id"] in position),
                        key=lambda one: position[one["id"]],
                    )
                ]

            conversation = Chat(
                state.get("embed_model"),
                [],
                system=state.get("system") or None,
                notes=state.get("notes") or [],
                passages=passages,
                payload_type=None if mode == "chat" else payload_type,
            )
            reply = await conversation.reply(
                state["question"],
                (state.get("history") or []) if state.get("use_history") else [],
            )
            return {"answer": reply.text, "citations": reply.citations}

        return run_output
