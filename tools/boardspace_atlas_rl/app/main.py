from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_admin import router as admin_router
from app.api.routes_compat import router as compat_router
from app.api.routes_health import router as health_router
from app.api.routes_sessions import router as sessions_router
from app.core.config import settings
from app.core.model_registry import ModelRegistry
from app.service.ai_jobs import AiJobManager
from app.service.session_manager import SessionManager
from app.service.training_manager import TrainingManager


app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model_registry = ModelRegistry(device=settings.default_device)
session_manager = SessionManager(model_registry=model_registry)
ai_job_manager = AiJobManager(session_manager=session_manager)
training_manager = TrainingManager(model_registry=model_registry)

app.state.model_registry = model_registry
app.state.session_manager = session_manager
app.state.ai_job_manager = ai_job_manager
app.state.training_manager = training_manager

app.include_router(health_router)
app.include_router(sessions_router)
app.include_router(admin_router)
app.include_router(compat_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "docs": "/docs"}

