from pydantic import BaseModel


class OutputFieldSchema(BaseModel):
    output_field: str
    from_semantic: str


class OutputProfileCreate(BaseModel):
    name: str
    description: str = ""
    include_all: bool = False
    fields: list[OutputFieldSchema] = []


class OutputProfileResponse(BaseModel):
    id: int
    name: str
    description: str = ""
    is_preset: bool
    profile_schema: dict