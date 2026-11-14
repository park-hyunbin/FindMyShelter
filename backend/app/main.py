from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator

from .analysis import unavailable_analysis

app = FastAPI(title="Feng Shui Lab", version="0.1.0")


class AnalysisRequest(BaseModel):
    address: str = Field(min_length=2, max_length=200)

    @field_validator("address", mode="before")
    @classmethod
    def strip_address(cls, value):
        return value.strip() if isinstance(value, str) else value


@app.get("/health")
def health():
    return {"status": "ok", "gis_connected": False}


@app.post("/api/v1/analyses")
def create_analysis(body: AnalysisRequest):
    return unavailable_analysis(body.address)
