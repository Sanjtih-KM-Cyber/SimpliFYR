from pydantic import BaseModel

from simplifyr_parsers import Format


from pydantic import BaseModel

from simplifyr_parsers import Format


class OnboardingSuggestion(BaseModel):
    input_field: str
    semantic_field: str
    confidence: float
    reason: str = ""


class OnboardingAnalyzeResponse(BaseModel):
    source: str | None = None
    detected_format: Format
    confidence: float
    suggestions: list[OnboardingSuggestion]


class OnboardingCreate(BaseModel):
    sample: str
    source_name: str | None = None


class OnboardingResponse(BaseModel):
    id: int
    status: str
    source_id: int | None = None
    sample_payload: str
    detected_format: Format
    detected_event_family: str
    detected_vendor: str | None = None
    detected_product: str | None = None
    confidence: float


class OnboardingFieldInput(BaseModel):
    input_field: str
    semantic_field: str


class OnboardingApprove(BaseModel):
    source_name: str | None = None
    mapping_name: str | None = None
    fields: list[OnboardingFieldInput] = []
    output_profile_id: int | None = None


class OnboardingApproveResponse(BaseModel):
    onboarding_id: int
    source_id: int
    mapping_id: int
    mapping_version: int
    recipe_id: int
    reprocessed_events: int = 0