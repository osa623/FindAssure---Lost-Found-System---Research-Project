from typing import Any, Dict, List
from pydantic import BaseModel, Field, field_validator


class IndexVectorRequest(BaseModel):
    vector_128d: List[float] = Field(..., description="Embedding vector to index in FAISS")
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("vector_128d")
    @classmethod
    def validate_vector_128d(cls, value: List[float]) -> List[float]:
        if len(value) != 128:
            raise ValueError(f"vector_128d must have exactly 128 dimensions; got {len(value)}")
        return value


class IndexVectorResponse(BaseModel):
    faiss_id: int


class SearchMatch(BaseModel):
    score: float
    faiss_id: int
    item_id: str | None = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    vector_hits: List[Dict[str, Any]] = Field(default_factory=list)
    vector_hits_count: int = 0


class SearchByImageResponse(BaseModel):
    top_k: int
    min_score: float
    category_filter: str | None = None
    matches: List[SearchMatch]
