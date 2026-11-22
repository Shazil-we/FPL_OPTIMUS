"""FastAPI application entrypoint for FPL-Optimus."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router, service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Pre-load the trained model bundle on startup so the first request is fast.
    service.get_bundle()
    yield
    if service._api is not None:
        await service._api.aclose()


app = FastAPI(
    title="FPL-Optimus API",
    description=(
        "Automated Fantasy Premier League Squad Selector, Transfer Optimizer, "
        "and Live Tracking Dashboard using Machine Learning and Local Search Optimization."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False if "*" in origins else True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
