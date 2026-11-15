import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.services.runtime import sync_service


@asynccontextmanager
async def lifespan(_: FastAPI):
    sync_task = await sync_service.start()
    try:
        yield
    finally:
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title='MODIS–VIIRS Firewatch API',
    description='Live NASA wildfire observations and satellite imagery metadata.',
    version='0.1.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(v1_router)


@app.get('/')
def read_root() -> dict[str, str]:
    return {'message': 'MODIS–VIIRS Firewatch API'}
