from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra="ignore")
    hugging_face_api_token: str
    embedding_pipeline_tag: str
    embedding_library: str
    api_client_ttl: float

settings = Settings()


