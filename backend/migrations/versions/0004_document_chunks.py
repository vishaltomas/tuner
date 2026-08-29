"""document chunks

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-29

"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


def read_sql(name: str) -> str:
    """Return a statement file, minus the trailing ';' Alembic re-adds itself."""
    return (SQL_DIR / name).read_text().rstrip().removesuffix(";")


def upgrade() -> None:
    op.execute(read_sql("0004_upgrade.sql"))


def downgrade() -> None:
    op.execute(read_sql("0004_downgrade.sql"))
