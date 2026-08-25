from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The backend directory, two levels up from app/config.py. Paths resolve
# against it rather than the process's working directory, so running from
# anywhere still finds the same .env and the same uploads.
BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")
    hugging_face_api_token: str
    embedding_pipeline_tag: str
    embedding_library: str
    api_client_ttl: float

    # PostgreSQL. `database_url` must carry the asyncpg driver
    # (postgresql+asyncpg://...); Alembic swaps in psycopg to run .sql files.
    database_url: str
    db_echo: bool = False
    db_pool_size: int = 5
    db_max_overflow: int = 10

    # Where uploaded documents are written, relative to this directory.
    upload_dir: str = "uploads"
    model_search_limit: int = 10
    # Where downloaded model snapshots are unpacked.
    model_dir: str = "models"

settings = Settings()
