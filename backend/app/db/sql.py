import re
from functools import cache
from pathlib import Path

from sqlalchemy import TextClause, text

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

# Statements are named in the file that holds them, one `-- name: <name>` line
# introducing each. Everything up to the next such line is that statement.
NAME = re.compile(r"^--[ \t]*name:[ \t]*(\S+)[ \t]*$", re.MULTILINE)


@cache
def catalogue() -> dict[str, str]:
    """Every named statement in `app/sql/`, keyed by name.

    The files group statements the way the schema is shaped: one per table for
    the writes against it, and `queries.sql` for every read. Grouping by table
    keeps the statements that can break a table's invariants in one place, and
    names rather than filenames mean a statement can be moved between files
    without touching the code that asks for it.

    Read once, on first use. A duplicate name is an error rather than a silent
    win for whichever file sorted last.
    """
    statements: dict[str, str] = {}
    origin: dict[str, Path] = {}

    for path in sorted(SQL_DIR.glob("*.sql")):
        content = path.read_text()
        headers = list(NAME.finditer(content))
        if not headers:
            raise ValueError(f"{path} has no '-- name:' statement headers")

        starts = [header.end() for header in headers]
        ends = [header.start() for header in headers[1:]] + [len(content)]

        for header, start, end in zip(headers, starts, ends, strict=True):
            name = header.group(1)
            if name in statements:
                raise ValueError(
                    f"statement {name!r} is defined twice: "
                    f"{origin[name].name} and {path.name}"
                )
            # The trailing semicolon comes off: a statement sent over the wire
            # is not terminated, though the files keep it so they read as SQL.
            body = content[start:end].strip().removesuffix(";").rstrip()
            if not body:
                raise ValueError(f"statement {name!r} in {path.name} is empty")
            statements[name] = body
            origin[name] = path

    return statements


@cache
def sql(name: str) -> TextClause:
    """Load a named statement, ready to execute.

    Every query in the application lives in `app/sql/`, so the SQL can be read
    — and reviewed — as SQL, the same way the migrations are.

    Parameters are named (`:id`), never interpolated, so values are bound by
    the driver. Casts are written `CAST(:x AS type)`: the `::` form collides
    with the `:name` parameter syntax.
    """
    try:
        return text(catalogue()[name])
    except KeyError:
        raise KeyError(f"no statement named {name!r} in {SQL_DIR}") from None
