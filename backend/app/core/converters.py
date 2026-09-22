from app.models import Mapping as MappingModel
from app.models import OutputProfile
from output_profiles import OutputProfile as PkgProfile
from simplifyr_mappings import FieldMapping, Mapping as PkgMapping


def to_package_mapping(mapping: MappingModel) -> PkgMapping:
    """Convert a persisted mapping into the mappings-engine model."""
    return PkgMapping(
        name=mapping.name,
        source=mapping.source,
        version=mapping.version,
        fields=[
            FieldMapping(
                input_field=f.input_field,
                semantic_field=f.semantic_field,
                transformation=f.transformation,
                confidence=f.confidence,
            )
            for f in mapping.fields
        ],
    )


def to_package_profile(profile: OutputProfile) -> PkgProfile:
    return PkgProfile.from_schema(
        name=profile.name,
        schema=profile.schema,
        is_preset=profile.is_preset,
        description=profile.description or "",
    )