from functools import cache
from pathlib import Path

from sqlalchemy import TextClause, text

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


@cache
def sql(name: str) -> TextClause:
    """Load `app/sql/<name>.sql` as a statement ready to execute.

    Every query in the application lives in that directory, so the SQL can be
    read — and reviewed — as SQL, the same way the migrations are. Files are
    read once and cached, and the trailing semicolon comes off because a
    statement sent over the wire is not terminated.

    Parameters are named (`:id`), never interpolated, so values are bound by
    the driver. Casts are written `CAST(:x AS type)`: the `::` form collides
    with the `:name` parameter syntax.
    """
    statement = (SQL_DIR / f"{name}.sql").read_text().rstrip().removesuffix(";")
    return text(statement)
