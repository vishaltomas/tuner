"""Workflows, and the `.flow` files inside them.

A workflow is a directory; the flows in it are files. `main.flow` is where a
run of that workflow starts, and an Agent widget inside it names a sibling
file to descend into. Chat picks a workflow by name and asks its `main.flow`.

Keeping them on disk is what makes the composition legible — the files diff,
they can be read and edited outside the app, and both the workflow and its
entry point are names you can see rather than conventions held in a database.
"""

import asyncio
import json
import re
import shutil
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.config import BASE_DIR, settings

# Where a run of a workflow starts. Named rather than flagged: a flow is the
# entry point because of what it is called, which is visible in the tree.
MAIN = "main.flow"

# The workflow loose flows are moved into, and what a fresh install opens on.
DEFAULT_WORKFLOW = "My workflow"

# What a new workflow's `main.flow` starts as: the two ends of a run, wired
# together. A blank canvas would be technically the same thing to build on,
# but it would not say that a run enters at one widget and leaves at another.
STARTER: dict = {
    "nodes": [
        {
            "id": "input",
            "kind": "input",
            "position": {"x": 120, "y": 60},
            "config": {"mode": "chat"},
        },
        {
            "id": "output",
            "kind": "output",
            "position": {"x": 120, "y": 400},
            "config": {"mode": "chat"},
        },
    ],
    "edges": [{"id": "input-output", "source": "input", "target": "output"}],
}

# Names become paths, so they are matched against these rather than sanitised
# — a rule about what a name *is* leaves no room for a `..` or a separator to
# survive some cleaning step.
FLOW_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}\.flow$")
WORKFLOW_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$")


def upgrade(graph: dict) -> dict:
    """Bring a flow written under an older widget vocabulary up to date.

    Flows are files the user has already made, so a change to what widgets
    exist cannot simply invalidate them. This maps the shapes that have been
    written to disk onto the current ones, in memory — the file itself is only
    rewritten when the user next saves it.

    `answer` became `output`, a `retrieval` widget's budget moved onto the
    Source widget it fed, a Source widget's single `sourceId` became a list,
    and every flow gained an `input` widget for the run to start at.
    """
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    kinds = {node.get("kind") for node in nodes}
    # Only a flow that actually holds an old widget is rewritten. A current
    # flow missing an Input widget is the user's own doing and is reported as
    # a problem, not silently patched behind them.
    if not nodes or not (kinds & {"answer", "retrieval"}):
        return graph

    # The old `retrieval` widget's budget belongs to whatever Source fed it.
    budget = next(
        (
            int((node.get("config") or {}).get("topK") or 0)
            for node in nodes
            if node.get("kind") == "retrieval"
        ),
        0,
    )
    dropped = {node["id"] for node in nodes if node.get("kind") == "retrieval"}

    kept: list[dict] = []
    for node in nodes:
        if node["id"] in dropped:
            continue
        node = {**node, "config": dict(node.get("config") or {})}
        if node.get("kind") == "answer":
            node["kind"] = "output"
            node["config"].setdefault("mode", "chat")
        if node.get("kind") == "source":
            single = node["config"].pop("sourceId", None)
            if single and not node["config"].get("sourceIds"):
                node["config"]["sourceIds"] = [single]
            if (node["config"].get("sourceType") or "files") == "files":
                node["config"].setdefault("method", "similarity")
                node["config"].setdefault("docs", budget or 6)
        kept.append(node)

    # A dropped widget's wires are rejoined around it, so a chain that ran
    # source → retrieval → answer still runs source → output.
    rewired: list[dict] = []
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source in dropped and target in dropped:
            continue
        if source in dropped:
            for upstream in edges:
                joins = upstream.get("target") == source
                if joins and upstream["source"] not in dropped:
                    rewired.append(
                        {
                            "id": f"{upstream['source']}-{target}",
                            "source": upstream["source"],
                            "target": target,
                        }
                    )
            continue
        if target in dropped:
            continue
        rewired.append(edge)

    # The old model embedded the question implicitly; the new one draws that
    # step. Inserted between the entry and the Source widgets that retrieve, so
    # an upgraded flow runs as it did rather than reporting a missing widget.
    retrieving = [
        node
        for node in kept
        if node.get("kind") == "source"
        and (node["config"].get("sourceType") or "files") == "files"
    ]
    if retrieving and not any(node.get("kind") == "embed" for node in kept):
        anchor = retrieving[0]["position"]
        kept.append(
            {
                "id": "embed",
                "kind": "embed",
                "position": {"x": anchor["x"], "y": anchor["y"] - 150},
                "config": {},
            }
        )
        for node in retrieving:
            rewired = [
                edge
                for edge in rewired
                if not (edge["target"] == node["id"] and edge["source"] != "embed")
            ]
            rewired.append(
                {"id": f"embed-{node['id']}", "source": "embed", "target": node["id"]}
            )

    if not any(node.get("kind") == "input" for node in kept):
        # Placed above whatever has no incoming wire, and joined to it, so the
        # upgraded flow reads the way it would have been drawn.
        entered = {edge["target"] for edge in rewired}
        roots = [node for node in kept if node["id"] not in entered]
        top = min((node["position"]["y"] for node in kept), default=60)
        left = min((node["position"]["x"] for node in kept), default=120)
        kept.insert(
            0,
            {
                "id": "input",
                "kind": "input",
                "position": {"x": left, "y": top - 160},
                "config": {"mode": "chat"},
            },
        )
        rewired.extend(
            {"id": f"input-{node['id']}", "source": "input", "target": node["id"]}
            for node in roots
        )

    return {"nodes": kept, "edges": rewired}


class FlowError(Exception):
    """Something that cannot be read or written, with a reason for the user."""


@dataclass(frozen=True, slots=True)
class FlowFile:
    """One `.flow` file, as the explorer lists it."""

    name: str
    size: int
    updated_at: datetime
    #: `main.flow` is where the workflow's run begins.
    is_main: bool


@dataclass(frozen=True, slots=True)
class WorkflowDir:
    """One workflow, as Chat and the explorer list it."""

    name: str
    #: How many `.flow` files it holds, `main.flow` included.
    flows: int
    updated_at: datetime


class Flows:
    """The workflow directory: what is in it, and how to read and write it.

    Every path this builds goes through `workflow_path` or `path`, so there is
    one place where a name becomes a location on disk and one rule about which
    names may.
    """

    def __init__(self, directory: Path | None = None):
        self.directory = directory or (BASE_DIR / settings.flow_dir)

    # ---- paths ---------------------------------------------------------

    def workflow_path(self, workflow: str) -> Path:
        """Where a workflow's directory is, refusing anything but a name."""
        if not WORKFLOW_NAME.fullmatch(workflow):
            raise FlowError(
                f"{workflow!r} is not a valid workflow name; use letters, "
                f"numbers, spaces, dashes or underscores"
            )
        resolved = (self.directory / workflow).resolve()
        if resolved.parent != self.directory.resolve():
            raise FlowError(f"{workflow!r} does not name a workflow")
        return resolved

    def path(self, workflow: str, name: str) -> Path:
        """Where one flow lives, refusing any name that is not just a name.

        Both halves arrive from the browser and become a filesystem path, so
        each is matched against its pattern and the result is checked again
        after resolving: the patterns already exclude separators and dots, and
        the second check is what would catch a symlink pointing out anyway.
        """
        if not FLOW_NAME.fullmatch(name):
            raise FlowError(
                f"{name!r} is not a valid flow name; use letters, numbers, "
                f"spaces, dashes or underscores, ending in .flow"
            )
        directory = self.workflow_path(workflow)
        resolved = (directory / name).resolve()
        if resolved.parent != directory:
            raise FlowError(f"{name!r} does not name a file in {workflow}")
        return resolved

    # ---- workflows -----------------------------------------------------

    def _describe_workflow(self, path: Path) -> WorkflowDir:
        found = list(path.glob("*.flow"))
        newest = max(
            (one.stat().st_mtime for one in found), default=path.stat().st_mtime
        )
        return WorkflowDir(
            name=path.name,
            flows=len(found),
            updated_at=datetime.fromtimestamp(newest, UTC),
        )

    def _list_workflows_sync(self) -> list[WorkflowDir]:
        if not self.directory.is_dir():
            return []
        return sorted(
            (
                self._describe_workflow(path)
                for path in self.directory.iterdir()
                if path.is_dir() and WORKFLOW_NAME.fullmatch(path.name)
            ),
            key=lambda one: one.name.lower(),
        )

    async def list_workflows(self) -> list[WorkflowDir]:
        return await asyncio.to_thread(self._list_workflows_sync)

    def _create_workflow_sync(self, name: str) -> WorkflowDir:
        path = self.workflow_path(name)
        if path.exists():
            raise FlowError(f"{name} already exists")
        path.mkdir(parents=True)
        # A workflow with no entry point cannot answer anything, so it is
        # created with one rather than left in a state Chat has to explain.
        self._write_sync(name, MAIN, deepcopy(STARTER))
        return self._describe_workflow(path)

    async def create_workflow(self, name: str) -> WorkflowDir:
        return await asyncio.to_thread(self._create_workflow_sync, name)

    def _rename_workflow_sync(self, old: str, new: str) -> WorkflowDir:
        source = self.workflow_path(old)
        destination = self.workflow_path(new)
        if not source.is_dir():
            raise FlowError(f"there is no workflow called {old}")
        if destination.exists() and destination != source:
            raise FlowError(f"{new} already exists")
        source.replace(destination)
        return self._describe_workflow(destination)

    async def rename_workflow(self, old: str, new: str) -> WorkflowDir:
        """Rename a workflow. Its flows move with it, untouched."""
        return await asyncio.to_thread(self._rename_workflow_sync, old, new)

    def _delete_workflow_sync(self, name: str) -> None:
        path = self.workflow_path(name)
        if not path.is_dir():
            raise FlowError(f"there is no workflow called {name}")
        if len(self._list_workflows_sync()) <= 1:
            raise FlowError(
                "this is the only workflow, and Chat would have nothing to "
                "run; create another before deleting it"
            )
        shutil.rmtree(path)

    async def delete_workflow(self, name: str) -> None:
        await asyncio.to_thread(self._delete_workflow_sync, name)

    # ---- flows ---------------------------------------------------------

    def _read_sync(self, workflow: str, name: str) -> dict:
        path = self.path(workflow, name)
        # Checked before the file, so a workflow that is not there says so
        # rather than blaming a `main.flow` that was never going to exist.
        if not path.parent.is_dir():
            raise FlowError(f"there is no workflow called {workflow}")
        if not path.is_file():
            raise FlowError(f"there is no {name} in {workflow}")
        try:
            graph = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            raise FlowError(f"{name} is not valid JSON: {exc}") from exc
        if not isinstance(graph, dict):
            raise FlowError(f"{name} does not hold a flow")
        graph.setdefault("nodes", [])
        graph.setdefault("edges", [])
        return upgrade(graph)

    async def read(self, workflow: str, name: str) -> dict:
        return await asyncio.to_thread(self._read_sync, workflow, name)

    def _write_sync(self, workflow: str, name: str, graph: dict) -> FlowFile:
        path = self.path(workflow, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written beside the target and moved into place, so a crash part way
        # through leaves the previous flow intact rather than half a file that
        # no longer parses.
        temporary = path.parent / f"{path.name}.tmp"
        temporary.write_text(json.dumps(graph, indent=2) + "\n")
        temporary.replace(path)
        return self._describe(path)

    async def write(self, workflow: str, name: str, graph: dict) -> FlowFile:
        return await asyncio.to_thread(self._write_sync, workflow, name, graph)

    @staticmethod
    def _describe(path: Path) -> FlowFile:
        stat = path.stat()
        return FlowFile(
            name=path.name,
            size=stat.st_size,
            updated_at=datetime.fromtimestamp(stat.st_mtime, UTC),
            is_main=path.name == MAIN,
        )

    def _list_sync(self, workflow: str) -> list[FlowFile]:
        directory = self.workflow_path(workflow)
        if not directory.is_dir():
            raise FlowError(f"there is no workflow called {workflow}")
        found = [
            self._describe(path) for path in directory.glob("*.flow") if path.is_file()
        ]
        # `main.flow` first, then alphabetical: the entry point is the one a
        # reader is looking for, and everything else is reached through it.
        return sorted(found, key=lambda one: (not one.is_main, one.name.lower()))

    async def list(self, workflow: str) -> list[FlowFile]:
        return await asyncio.to_thread(self._list_sync, workflow)

    def _delete_sync(self, workflow: str, name: str) -> None:
        if name == MAIN:
            raise FlowError(
                "main.flow is where this workflow starts and cannot be "
                "deleted; clear its widgets instead"
            )
        path = self.path(workflow, name)
        if not path.is_file():
            raise FlowError(f"there is no {name} in {workflow}")
        path.unlink()

    async def delete(self, workflow: str, name: str) -> None:
        await asyncio.to_thread(self._delete_sync, workflow, name)

    def _rename_sync(self, workflow: str, old: str, new: str) -> FlowFile:
        if old == MAIN:
            raise FlowError(
                "main.flow is where this workflow starts and cannot be "
                "renamed; the entry point is the name"
            )
        source = self.path(workflow, old)
        destination = self.path(workflow, new)
        if not source.is_file():
            raise FlowError(f"there is no {old} in {workflow}")
        if destination.exists() and destination != source:
            raise FlowError(f"{new} already exists in {workflow}")

        source.replace(destination)

        # Agent widgets name the flow they run, so a rename that left those
        # alone would break every flow pointing at this one — and only at the
        # next question, not here where it could be explained.
        for path in destination.parent.glob("*.flow"):
            if path == destination:
                continue
            try:
                graph = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            touched = False
            for node in graph.get("nodes", []):
                config = node.get("config") or {}
                if node.get("kind") == "agent" and config.get("flow") == old:
                    config["flow"] = new
                    node["config"] = config
                    touched = True
            if touched:
                self._write_sync(workflow, path.name, graph)

        return self._describe(destination)

    async def rename(self, workflow: str, old: str, new: str) -> FlowFile:
        """Rename a flow, repointing the Agent widgets that call it."""
        return await asyncio.to_thread(self._rename_sync, workflow, old, new)

    # ---- first run -----------------------------------------------------

    def _ensure_sync(self) -> None:
        """Make sure there is a workflow to open, and an entry point in it.

        Also moves any loose `.flow` files left at the root by the earlier
        flat layout into the default workflow, so an existing install keeps
        its work rather than appearing to have lost it.
        """
        self.directory.mkdir(parents=True, exist_ok=True)

        loose = [path for path in self.directory.glob("*.flow") if path.is_file()]
        if loose:
            home = self.directory / DEFAULT_WORKFLOW
            home.mkdir(exist_ok=True)
            for path in loose:
                path.replace(home / path.name)

        existing = self._list_workflows_sync()
        if not existing:
            self._create_workflow_sync(DEFAULT_WORKFLOW)
            return

        # A workflow without an entry point cannot answer anything, and one
        # can appear that way if its main.flow was deleted from disk.
        for workflow in existing:
            if not (self.directory / workflow.name / MAIN).is_file():
                self._write_sync(workflow.name, MAIN, deepcopy(STARTER))

    async def ensure(self) -> None:
        await asyncio.to_thread(self._ensure_sync)


flows = Flows()
