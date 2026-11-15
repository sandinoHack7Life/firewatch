from app.container import fire_repository
from app.core.config import get_settings
from app.services.alerts.service import AlertService
from app.services.sync_service import LiveSyncService

settings = get_settings()
alert_service = AlertService(settings, fire_repository)
sync_service = LiveSyncService(settings, fire_repository, alert_service)
