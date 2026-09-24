import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from simplifyr_parsers import Format

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class EventFamily(str, enum.Enum):
    NETWORK_TRAFFIC = "network_traffic"
    AUTHENTICATION = "authentication"
    CONNECTION = "connection"
    POLICY = "policy"
    VPN = "vpn"
    CONFIG_CHANGE = "config_change"
    THREAT = "threat"
    OTHER = "other"
    UNKNOWN = "unknown"


class MappingStatus(str, enum.Enum):
    DRAFT = "draft"
    TESTING = "testing"
    APPROVED = "approved"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"


class SourceStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"


class OnboardingStatus(str, enum.Enum):
    PENDING = "pending"
    ANALYZING = "analyzing"
    REVIEW = "review"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class EventStatus(str, enum.Enum):
    RECEIVED = "received"
    PARSED = "parsed"
    NORMALIZED = "normalized"
    OUTPUT = "output"
    QUARANTINED = "quarantined"
    DLQ = "dlq"


class Environment(Base):
    __tablename__ = "environments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendors: Mapped[list["Vendor"]] = relationship(back_populates="environment")
    sources: Mapped[list["Source"]] = relationship(back_populates="environment")
    output_profiles: Mapped[list["OutputProfile"]] = relationship(back_populates="environment")
    onboardings: Mapped[list["Onboarding"]] = relationship(back_populates="environment")


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    environment_id: Mapped[int] = mapped_column(ForeignKey("environments.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    environment: Mapped[Environment] = relationship(back_populates="vendors")
    products: Mapped[list["Product"]] = relationship(back_populates="vendor", cascade="all, delete-orphan")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("vendors.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vendor: Mapped[Vendor] = relationship(back_populates="products")
    sources: Mapped[list["Source"]] = relationship(back_populates="product")


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    environment_id: Mapped[int] = mapped_column(ForeignKey("environments.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    format: Mapped[Format] = mapped_column(String(32), default=Format.UNKNOWN)
    status: Mapped[SourceStatus] = mapped_column(String(32), default=SourceStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    environment: Mapped[Environment] = relationship(back_populates="sources")
    product: Mapped[Product | None] = relationship(back_populates="sources")
    versions: Mapped[list["SourceVersion"]] = relationship(
        back_populates="source", cascade="all, delete-orphan"
    )


class SourceVersion(Base):
    __tablename__ = "source_versions"
    __table_args__ = (UniqueConstraint("source_id", "version", name="uq_source_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    source: Mapped[Source] = relationship(back_populates="versions")
    mappings: Mapped[list["Mapping"]] = relationship(back_populates="source_version")


class Mapping(Base):
    __tablename__ = "mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_versions.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    event_family: Mapped[EventFamily] = mapped_column(String(32), default=EventFamily.UNKNOWN)
    status: Mapped[MappingStatus] = mapped_column(String(32), default=MappingStatus.DRAFT)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    source_version: Mapped[SourceVersion | None] = relationship(back_populates="mappings")
    fields: Mapped[list["MappingField"]] = relationship(
        back_populates="mapping", cascade="all, delete-orphan"
    )


class MappingField(Base):
    __tablename__ = "mapping_fields"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mapping_id: Mapped[int] = mapped_column(ForeignKey("mappings.id"), nullable=False)
    input_field: Mapped[str] = mapped_column(String(255), nullable=False)
    semantic_field: Mapped[str] = mapped_column(String(255), nullable=False)
    transformation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

    mapping: Mapped[Mapping] = relationship(back_populates="fields")


class OutputProfile(Base):
    __tablename__ = "output_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    environment_id: Mapped[int | None] = mapped_column(
        ForeignKey("environments.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=False)
    schema: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    environment: Mapped[Environment | None] = relationship(back_populates="output_profiles")


class Onboarding(Base):
    __tablename__ = "onboardings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    environment_id: Mapped[int] = mapped_column(ForeignKey("environments.id"), nullable=False)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"), nullable=True)
    status: Mapped[OnboardingStatus] = mapped_column(String(32), default=OnboardingStatus.PENDING)
    sample_payload: Mapped[str] = mapped_column(Text, nullable=False)
    detected_format: Mapped[Format] = mapped_column(String(32), default=Format.UNKNOWN)
    detected_event_family: Mapped[EventFamily] = mapped_column(
        String(32), default=EventFamily.UNKNOWN
    )
    detected_vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_product: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    proposal: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    environment: Mapped[Environment] = relationship(back_populates="onboardings")


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[ApprovalStatus] = mapped_column(String(32), default=ApprovalStatus.PENDING)
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"), nullable=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    environment: Mapped[str] = mapped_column(String(64), default="default", index=True)
    status: Mapped[EventStatus] = mapped_column(String(32), default=EventStatus.RECEIVED)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    raw: Mapped[str] = mapped_column(Text, nullable=False)
    raw_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    raw_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_format: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    parsed: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    normalized: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    provenance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    processing_ms: Mapped[float | None] = mapped_column(Float, nullable=True)


class DriftRecord(Base):
    __tablename__ = "drift_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    mapping_id: Mapped[int | None] = mapped_column(ForeignKey("mappings.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="detected")
    new_fields: Mapped[list] = mapped_column(JSON, default=list)
    missing_fields: Mapped[list] = mapped_column(JSON, default=list)
    proposal: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    sample: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Recipe(Base):
    """Persistent configure-once binding: source -> mapping -> output profile.

    Incoming logs for the source automatically follow the recipe: the engine
    resolves the mapping and output profile from here without per-request config.
    """

    __tablename__ = "recipes"
    __table_args__ = (UniqueConstraint("source", name="uq_recipe_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    mapping_id: Mapped[int] = mapped_column(ForeignKey("mappings.id"), nullable=False)
    output_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("output_profiles.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    mapping: Mapped[Mapping] = relationship()
    output_profile: Mapped[OutputProfile | None] = relationship()


class Destination(Base):
    """Persistent output destination: configure once, Simplifyr delivers continuously."""

    __tablename__ = "destinations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)  # console | http | s3 | kafka
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)