from typing import List, Dict, Optional, Tuple, Any
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict

class PP2PerViewDetection(BaseModel):
    bbox: Tuple[float, float, float, float] = Field(
        ..., 
        description="Bounding box coordinates (x1, y1, x2, y2)"
    )
    cls_name: str
    confidence: float
    selected_by: Optional[str] = None
    outlier_view: Optional[bool] = None
    candidates: Optional[List["PP2DetectionCandidate"]] = None


class PP2DetectionCandidate(BaseModel):
    raw_label: str
    canonical_label: Optional[str] = None
    confidence: float
    bbox: Tuple[float, float, float, float]

class PP2PerViewExtraction(BaseModel):
    caption: str
    ocr_text: str
    grounded_features: Dict[str, Any]
    extraction_confidence: Optional[float] = None
    raw: Optional[Dict[str, Any]] = None

class PP2PerViewEmbedding(BaseModel):
    dim: int
    vector_preview: List[float] = Field(
        ..., 
        max_length=8,
        description="First 8 floats of the embedding vector"
    )
    vector_id: str

class PP2PerViewResult(BaseModel):
    view_index: int
    filename: str
    detection: PP2PerViewDetection
    extraction: PP2PerViewExtraction
    embedding: PP2PerViewEmbedding
    quality_score: float

class PP2VerificationResult(BaseModel):
    mode: str = Field(
        default="unsupported",
        description="Verification decision mode: two_view, three_view, or unsupported."
    )
    cosine_sim_matrix: List[List[float]] = Field(
        ..., 
        description="NxN cosine similarity matrix where N is input view count (2 or 3)"
    )
    faiss_sim_matrix: List[List[float]] = Field(
        ..., 
        description="NxN FAISS similarity matrix where N is input view count (2 or 3)"
    )
    geometric_scores: Dict[str, Any] = Field(
        ..., 
        description="Pairwise geometric consistency scores (e.g., '0-1': {...})"
    )
    passed: bool
    failure_reasons: List[str]
    used_views: List[int] = Field(default_factory=list)
    dropped_views: List["PP2DroppedView"] = Field(default_factory=list)

    @staticmethod
    def _validate_square_matrix(name: str, matrix: List[List[float]]) -> List[List[float]]:
        n = len(matrix)
        if n < 2 or n > 3:
            raise ValueError(f"{name} must be NxN with N between 2 and 3; got N={n}.")

        for idx, row in enumerate(matrix):
            if len(row) != n:
                raise ValueError(
                    f"{name} must be square; row {idx} has length {len(row)} but expected {n}."
                )
        return matrix

    @field_validator("cosine_sim_matrix")
    @classmethod
    def validate_cosine_sim_matrix(cls, v: List[List[float]]) -> List[List[float]]:
        return cls._validate_square_matrix("cosine_sim_matrix", v)

    @field_validator("faiss_sim_matrix")
    @classmethod
    def validate_faiss_sim_matrix(cls, v: List[List[float]]) -> List[List[float]]:
        return cls._validate_square_matrix("faiss_sim_matrix", v)

    @field_validator("used_views")
    @classmethod
    def validate_used_views(cls, v: List[int]) -> List[int]:
        if len(v) not in {0, 2}:
            raise ValueError("used_views must contain either 0 or 2 indices.")
        if len(set(v)) != len(v):
            raise ValueError("used_views must not contain duplicate indices.")
        for idx in v:
            if idx < 0:
                raise ValueError("used_views indices must be non-negative.")
        return v

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        mode = str(v or "").strip().lower()
        allowed = {"two_view", "three_view", "unsupported"}
        if mode not in allowed:
            raise ValueError(f"mode must be one of {sorted(allowed)}.")
        return mode

    @model_validator(mode="after")
    def validate_dropped_vs_used(self) -> "PP2VerificationResult":
        used = set(self.used_views)
        dropped = [dv.view_index for dv in self.dropped_views]
        if len(set(dropped)) != len(dropped):
            raise ValueError("dropped_views must not contain duplicate view indices.")
        overlap = used.intersection(dropped)
        if overlap:
            raise ValueError(
                f"dropped_views must not overlap with used_views; overlapping indices: {sorted(overlap)}."
            )
        n = len(self.cosine_sim_matrix)
        for idx in self.used_views:
            if idx >= n:
                raise ValueError(
                    f"used_views index {idx} is out of range for matrix dimension {n}."
                )
        for idx in dropped:
            if idx < 0 or idx >= n:
                raise ValueError(
                    f"dropped_views index {idx} is out of range for matrix dimension {n}."
                )
        return self


class PP2DroppedView(BaseModel):
    view_index: int
    reason: str

class PP2FusedProfile(BaseModel):
    category: str
    brand: Optional[str] = None
    color: Optional[str] = None
    caption: Optional[str] = None
    merged_ocr_tokens: List[str]
    attributes: Dict[str, Any]
    defects: List[str]
    best_view_index: int
    fused_embedding_id: str

class PP2Response(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    item_id: str = Field(..., description="Unique identifier for the item (UUID string)")
    per_view: List[PP2PerViewResult] = Field(..., description="Results for 2 or 3 input views")
    verification: PP2VerificationResult
    fused: Optional[PP2FusedProfile] = None
    stored: bool
    cache_key: Optional[str] = None

    @field_validator('per_view')
    @classmethod
    def validate_view_count(cls, v: List[PP2PerViewResult]) -> List[PP2PerViewResult]:
        if len(v) < 2 or len(v) > 3:
            raise ValueError(f"Expected 2 or 3 views in response, got {len(v)}")
        return v

    @model_validator(mode="after")
    def validate_response_consistency(self) -> "PP2Response":
        n = len(self.per_view)
        cosine_n = len(self.verification.cosine_sim_matrix)
        faiss_n = len(self.verification.faiss_sim_matrix)

        if cosine_n != n:
            raise ValueError(
                f"cosine_sim_matrix dimension must match per_view count ({n}); got {cosine_n}."
            )
        if faiss_n != n:
            raise ValueError(
                f"faiss_sim_matrix dimension must match per_view count ({n}); got {faiss_n}."
            )

        allowed_pairs = {f"{i}-{j}" for i in range(n) for j in range(i + 1, n)}
        for pair_key in self.verification.geometric_scores.keys():
            if pair_key not in allowed_pairs:
                raise ValueError(
                    "geometric_scores contains invalid pair key "
                    f"'{pair_key}' for {n} views; allowed: {sorted(allowed_pairs)}."
                )

        return self

class PP2VerifyPairResponse(BaseModel):
    cosine_like_score_faiss: float
    geometric: Dict[str, Any]
    passed: bool
    threshold: float

