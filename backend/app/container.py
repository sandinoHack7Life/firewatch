from app.core.config import get_settings
from app.repositories.field_visit_repository import FieldVisitRepository
from app.repositories.fire_repository import FireRepository

settings = get_settings()
fire_repository = FireRepository(
    settings.observation_database_path,
    retention_days=settings.observation_retention_days,
)
field_visit_repository = FieldVisitRepository(settings.field_visits_database_path)
