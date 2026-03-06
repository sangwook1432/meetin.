from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = Field(default="MEETIN API", alias="APP_NAME")
    env: str = Field(default="local", alias="ENV")
    debug: bool = Field(default=True, alias="DEBUG")

    database_url: str = Field(alias="DATABASE_URL")

    jwt_secret: str = Field(alias="JWT_SECRET")
    jwt_alg: str = Field(default="HS256", alias="JWT_ALG")
    access_token_expire_minutes: int = Field(default=60, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=14, alias="REFRESH_TOKEN_EXPIRE_DAYS")

    phone_hmac_secret: str = Field(alias="PHONE_HMAC_SECRET")

    admin_emails: str = Field(default="", alias="ADMIN_EMAILS")

    def admin_email_set(self) -> set[str]:
        raw = (self.admin_emails or "").strip()
        if not raw:
            return set()
        return {e.strip().lower() for e in raw.split(",") if e.strip()}


settings = Settings()
