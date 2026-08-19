"""sources and source documents

Revision ID: 0001
Revises:
Create Date: 2026-08-19

"""
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The DDL lives in migrations/sql/, so every statement in this project is
# readable as plain SQL. This module only names which file runs when.
SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


def read_sql(name: str) -> str:
    """Return a statement file, minus the trailing ';' Alembic re-adds itself."""
    return (SQL_DIR / name).read_text().rstrip().removesuffix(";")


def upgrade() -> None:
    op.execute(read_sql("0001_upgrade.sql"))


def downgrade() -> None:
    op.execute(read_sql("0001_downgrade.sql"))
