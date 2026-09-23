"""Vendor / Product / Source / SourceVersion catalog (§13 Knowledge Registry).

Tables existed but had no API — knowledge could only be created implicitly by
ingesting events. These endpoints expose the hierarchy explicitly, scoped by
environment via the X-Environment header.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.environment import get_environment
from app.core.security import require_auth, require_write
from app.core.sources import ensure_source_version, resolve_environment
from app.models import Product, Source, SourceVersion, Vendor
from app.schemas.catalog import (
    ProductCreate,
    ProductResponse,
    SourceCreate,
    SourceResponse,
    SourceStatusUpdate,
    VendorCreate,
    VendorResponse,
    VersionCreate,
    VersionResponse,
)

router = APIRouter(prefix="/catalog", tags=["catalog"], dependencies=[Depends(require_auth)])


def _env_id(db: Session, environment: str) -> int:
    return resolve_environment(db, environment).id


# --- vendors ---


@router.get("/vendors", response_model=list[VendorResponse])
def list_vendors(environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    rows = (
        db.execute(select(Vendor).where(Vendor.environment_id == _env_id(db, environment)))
        .scalars()
        .all()
    )
    return [VendorResponse(id=v.id, name=v.name, environment_id=v.environment_id, created_at=as_utc(v.created_at)) for v in rows]


@router.post("/vendors", response_model=VendorResponse, status_code=201, dependencies=[Depends(require_write)])
def create_vendor(payload: VendorCreate, environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Vendor name is required")
    env_id = _env_id(db, payload.environment or environment)
    vendor = Vendor(name=name, environment_id=env_id)
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    log_action(db, action="create", entity_type="vendor", entity_id=vendor.id, after={"name": name})
    db.commit()
    return VendorResponse(id=vendor.id, name=vendor.name, environment_id=vendor.environment_id, created_at=as_utc(vendor.created_at))


# --- products ---


@router.get("/products", response_model=list[ProductResponse])
def list_products(vendor_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Product)
    if vendor_id is not None:
        stmt = stmt.where(Product.vendor_id == vendor_id)
    rows = db.execute(stmt).scalars().all()
    return [ProductResponse(id=p.id, name=p.name, vendor_id=p.vendor_id, created_at=as_utc(p.created_at)) for p in rows]


@router.post("/products", response_model=ProductResponse, status_code=201, dependencies=[Depends(require_write)])
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Product name is required")
    vendor = db.get(Vendor, payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    product = Product(name=name, vendor_id=vendor.id)
    db.add(product)
    db.commit()
    db.refresh(product)
    log_action(db, action="create", entity_type="product", entity_id=product.id, after={"name": name, "vendor_id": vendor.id})
    db.commit()
    return ProductResponse(id=product.id, name=product.name, vendor_id=product.vendor_id, created_at=as_utc(product.created_at))


# --- sources ---


@router.get("/sources", response_model=list[SourceResponse])
def list_sources(environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    rows = (
        db.execute(select(Source).where(Source.environment_id == _env_id(db, environment)))
        .scalars()
        .all()
    )
    return [_source_to_response(s) for s in rows]


@router.post("/sources", response_model=SourceResponse, status_code=201, dependencies=[Depends(require_write)])
def create_source(payload: SourceCreate, environment: str = Depends(get_environment), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Source name is required")
    env_id = _env_id(db, payload.environment or environment)
    if payload.product_id is not None and db.get(Product, payload.product_id) is None:
        raise HTTPException(status_code=404, detail="Product not found")
    source = Source(name=name, environment_id=env_id, product_id=payload.product_id, address=payload.address)
    db.add(source)
    db.flush()
    ensure_source_version(db, source)
    db.commit()
    db.refresh(source)
    log_action(db, action="create", entity_type="source", entity_id=source.id, after={"name": name})
    db.commit()
    return _source_to_response(source)


@router.get("/sources/{source_id}", response_model=SourceResponse)
def get_source(source_id: int, db: Session = Depends(get_db)):
    return _source_to_response(_get_source(db, source_id))


@router.patch("/sources/{source_id}", response_model=SourceResponse, dependencies=[Depends(require_write)])
def update_source(source_id: int, payload: SourceStatusUpdate, db: Session = Depends(get_db)):
    source = _get_source(db, source_id)
    before = {"status": str(source.status), "address": source.address}
    if payload.status is not None:
        source.status = payload.status
    if payload.address is not None:
        source.address = payload.address
    db.commit()
    log_action(db, action="update", entity_type="source", entity_id=source.id, before=before, after={"status": str(source.status), "address": source.address})
    db.commit()
    db.refresh(source)
    return _source_to_response(source)


def _get_source(db: Session, source_id: int) -> Source:
    source = db.get(Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


def _source_to_response(s: Source) -> SourceResponse:
    return SourceResponse(
        id=s.id,
        name=s.name,
        environment_id=s.environment_id,
        product_id=s.product_id,
        address=s.address,
        status=s.status,
        created_at=as_utc(s.created_at),
    )


# --- versions ---


@router.get("/sources/{source_id}/versions", response_model=list[VersionResponse])
def list_versions(source_id: int, db: Session = Depends(get_db)):
    _get_source(db, source_id)
    rows = db.execute(select(SourceVersion).where(SourceVersion.source_id == source_id)).scalars().all()
    return [_version_to_response(v) for v in rows]


@router.post("/sources/{source_id}/versions", response_model=VersionResponse, status_code=201, dependencies=[Depends(require_write)])
def create_version(source_id: int, payload: VersionCreate, db: Session = Depends(get_db)):
    source = _get_source(db, source_id)
    version = payload.version.strip()
    if not version:
        raise HTTPException(status_code=422, detail="Version is required")
    existing = db.execute(
        select(SourceVersion).where(SourceVersion.source_id == source.id, SourceVersion.version == version)
    ).scalars().first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Version already exists for this source")
    row = SourceVersion(source_id=source.id, version=version, active=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    log_action(db, action="create", entity_type="source_version", entity_id=row.id, after={"source_id": source.id, "version": version})
    db.commit()
    return _version_to_response(row)


def _version_to_response(v: SourceVersion) -> VersionResponse:
    return VersionResponse(id=v.id, source_id=v.source_id, version=v.version, active=v.active, created_at=as_utc(v.created_at))
