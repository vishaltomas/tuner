from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra="ignore")
    hugging_face_api_token: str

settings = Settings()


