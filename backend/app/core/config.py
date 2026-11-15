from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ENV_FILE = Path(__file__).resolve().parents[3] / '.env'


class Settings(BaseSettings):
    app_env: str = 'development'
    app_port: int = 8000
    log_level: str = 'INFO'
    database_url: str = 'postgresql+psycopg://postgres:postgres@localhost:5432/firewatch'
    firms_map_key: str = ''
    firms_day_range: int = 2
    observation_retention_days: int = 730
    sync_interval_seconds: int = 300
    eonet_api_url: str = 'https://eonet.gsfc.nasa.gov/api/v3/events'
    planetary_computer_stac_url: str = 'https://planetarycomputer.microsoft.com/api/stac/v1'
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from_email: str = ''
    smtp_use_starttls: bool = True
    observation_database_path: str = str(
        Path.home() / '.modis-viirs-firewatch' / 'observations.sqlite3'
    )
    alerts_database_path: str = str(
        Path.home() / '.modis-viirs-firewatch' / 'alerts.sqlite3'
    )
    field_visits_database_path: str = str(
        Path.home() / '.modis-viirs-firewatch' / 'field_visits.sqlite3'
    )

    model_config = SettingsConfigDict(
        env_file=PROJECT_ENV_FILE,
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
