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

    # CORS: 콤마 구분 허용 origin 목록
    # 예) ALLOWED_ORIGINS=https://meetin.kr,https://www.meetin.kr
    allowed_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="ALLOWED_ORIGINS",
    )

    def admin_email_set(self) -> set[str]:
        raw = (self.admin_emails or "").strip()
        if not raw:
            return set()
        return {e.strip().lower() for e in raw.split(",") if e.strip()}

    def allowed_origins_list(self) -> list[str]:
        """환경변수 하나로 여러 origin 관리 — 배포 시 프론트 도메인만 추가하면 됨"""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
