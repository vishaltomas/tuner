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
    # Where the `.flow` files live. `main.flow` in here is where a run starts.
    flow_dir: str = "flows"
    # Where a deployed image writes its exported workflows.
    export_dir: str = "exports"
    # A SQLite file holding the passages a deployed image was built with.
    # Empty here, where Postgres is the store; set inside an exported image,
    # which carries its vectors and has no database to reach.
    vector_db: str = ""

    # Chat. Retrieval runs locally against the vectors in Postgres; the answer
    # is written by a served model on the Hugging Face Inference API, reached
    # with the same token the Hub search uses. `chat_provider` picks the
    # inference partner — "auto" takes whichever one serves the model.
    chat_model: str = "meta-llama/Llama-3.1-8B-Instruct"
    chat_provider: str = "auto"
    chat_max_tokens: int = 1024
    chat_temperature: float = 0.2
    # Passages put in front of the model per question. Each is at most one
    # embedding model's context, so this is the knob that sets the prompt size.
    chat_context_chunks: int = 6

settings = Settings()
