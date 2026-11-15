from fastapi import APIRouter

from app.api.v1.endpoints.alerts import router as alerts_router
from app.api.v1.endpoints.analytics import router as analytics_router
from app.api.v1.endpoints.calendar import router as calendar_router
from app.api.v1.endpoints.dashboard import router as dashboard_router
from app.api.v1.endpoints.data_sources import router as data_sources_router
from app.api.v1.endpoints.fire_map import router as fire_map_router
from app.api.v1.endpoints.fires import router as fires_router
from app.api.v1.endpoints.field_visits import router as field_visits_router
from app.api.v1.endpoints.harmonization import router as harmonization_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.planetary_computer import router as planetary_computer_router
from app.api.v1.endpoints.parks import router as parks_router
from app.api.v1.endpoints.reports import router as reports_router
from app.api.v1.endpoints.system import router as system_router

router = APIRouter(prefix='/api/v1')

router.include_router(health_router)
router.include_router(dashboard_router)
router.include_router(fires_router)
router.include_router(fire_map_router)
router.include_router(calendar_router)
router.include_router(analytics_router)
router.include_router(harmonization_router)
router.include_router(data_sources_router)
router.include_router(reports_router)
router.include_router(system_router)
router.include_router(planetary_computer_router)
router.include_router(parks_router)
router.include_router(field_visits_router)
router.include_router(alerts_router)
