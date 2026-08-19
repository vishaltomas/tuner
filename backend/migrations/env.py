from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# `models` is imported for the side effect of registering every table on
# Base.metadata. `alembic check` compares that metadata against the live schema,
# which is how hand-written SQL migrations are kept honest — so a new model
# module has to be imported here too.
import models  # noqa: F401
from config import settings
from db import Base

config = context.config


def migration_url() -> str:
    """The app's URL on a sync driver.

    Migrations run whole .sql files, and asyncpg sends statements as prepared
    statements — which Postgres refuses when a string holds more than one
    command. psycopg has no such limit, and a migration gains nothing from
    being async.
    """
    return settings.database_url.replace("+asyncpg", "+psycopg")


# Credentials live in .env, never in alembic.ini.
config.set_main_option("sqlalchemy.url", migration_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting, for review or manual apply."""
    context.configure(
        url=migration_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Without these, `alembic check` misses type and default edits.
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
