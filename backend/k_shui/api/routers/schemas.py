"""Schema Registry endpoints (`/clusters/{c}/schemas/...`)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from k_shui.api.schemas.schemas import (
    CompatibilityRequest,
    CompatibilityResult,
    ConfigBody,
    ConfigResult,
    RegisterSchemaRequest,
    RegisterSchemaResult,
    RegistryInfo,
    SchemaById,
    SchemaDiff,
    SchemaVersion,
    SubjectDetail,
    SubjectSummary,
)
from k_shui.core.registry import ClusterContext, get_cluster
from k_shui.integrations.audit import audit, publish
from k_shui.integrations.schema_registry import get_schema_registry, parse_version

router = APIRouter(tags=["schemas"])
BASE = "/clusters/{cluster_id}/schemas"


@router.get(BASE + "/info", response_model=RegistryInfo)
async def registry_info(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_schema_registry(ctx).info()


@router.get(BASE + "/config", response_model=ConfigResult)
async def global_config(ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_schema_registry(ctx).get_global_config()


@router.put(BASE + "/config", response_model=ConfigResult)
async def set_global_config(
    request: Request, body: ConfigBody, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    result = await get_schema_registry(ctx).set_global_config(body.compatibility)
    await audit(request, "schema.config.update", "schemas/config", {"compatibility": body.compatibility})
    return result


@router.get(BASE + "/subjects", response_model=list[SubjectSummary])
async def list_subjects(
    ctx: ClusterContext = Depends(get_cluster),
    search: str | None = Query(None),
    deleted: bool = Query(False),
) -> Any:
    return await get_schema_registry(ctx).list_subjects(search=search, deleted=deleted)


@router.get(BASE + "/subjects/{subject}", response_model=SubjectDetail)
async def subject_detail(
    subject: str, ctx: ClusterContext = Depends(get_cluster), deleted: bool = Query(False)
) -> Any:
    return await get_schema_registry(ctx).subject_detail(subject, deleted=deleted)


@router.delete(BASE + "/subjects/{subject}")
async def delete_subject(
    request: Request,
    subject: str,
    ctx: ClusterContext = Depends(get_cluster),
    permanent: bool = Query(False),
) -> dict[str, Any]:
    versions = await get_schema_registry(ctx).delete_subject(subject, permanent=permanent)
    await audit(request, "schema.subject.delete", f"schemas/{subject}", {"permanent": permanent})
    return {"subject": subject, "deletedVersions": versions, "permanent": permanent}


@router.get(BASE + "/subjects/{subject}/config", response_model=ConfigResult)
async def subject_config(subject: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    client = get_schema_registry(ctx)
    config = await client.get_subject_config(subject)
    if not config.get("compatibility"):
        globals_ = await client.get_global_config()
        return {"compatibility": globals_.get("compatibility"), "explicit": False}
    return config


@router.put(BASE + "/subjects/{subject}/config", response_model=ConfigResult)
async def set_subject_config(
    request: Request, subject: str, body: ConfigBody, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    result = await get_schema_registry(ctx).set_subject_config(subject, body.compatibility)
    await audit(
        request, "schema.subject.config.update", f"schemas/{subject}", {"compatibility": body.compatibility}
    )
    return result


@router.delete(BASE + "/subjects/{subject}/config", response_model=ConfigResult)
async def reset_subject_config(
    request: Request, subject: str, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    result = await get_schema_registry(ctx).delete_subject_config(subject)
    await audit(request, "schema.subject.config.reset", f"schemas/{subject}", {})
    return result


@router.get(BASE + "/subjects/{subject}/versions/{version}", response_model=SchemaVersion)
async def get_version(subject: str, version: str, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_schema_registry(ctx).get_version(subject, parse_version(version))


@router.post(BASE + "/subjects/{subject}/versions", response_model=RegisterSchemaResult, status_code=201)
async def register_schema(
    request: Request,
    subject: str,
    body: RegisterSchemaRequest,
    ctx: ClusterContext = Depends(get_cluster),
) -> Any:
    result = await get_schema_registry(ctx).register(
        subject,
        body.text(),
        schema_type=body.schemaType,
        references=body.references,
        normalize=body.normalize,
    )
    await audit(request, "schema.register", f"schemas/{subject}", {"schemaType": body.schemaType})
    await publish("schema.registered", ctx.id, {"subject": subject, **result})
    return result


@router.delete(BASE + "/subjects/{subject}/versions/{version}")
async def delete_version(
    request: Request,
    subject: str,
    version: str,
    ctx: ClusterContext = Depends(get_cluster),
    permanent: bool = Query(False),
) -> dict[str, Any]:
    deleted = await get_schema_registry(ctx).delete_version(
        subject, parse_version(version), permanent=permanent
    )
    await audit(request, "schema.version.delete", f"schemas/{subject}/{version}", {"permanent": permanent})
    return {"subject": subject, "version": deleted, "permanent": permanent}


@router.post(BASE + "/subjects/{subject}/compatibility", response_model=CompatibilityResult)
async def check_compatibility(
    subject: str, body: CompatibilityRequest, ctx: ClusterContext = Depends(get_cluster)
) -> Any:
    return await get_schema_registry(ctx).check_compatibility(
        subject,
        body.text(),
        schema_type=body.schemaType,
        references=body.references,
        version=body.version,
        normalize=body.normalize,
    )


@router.get(BASE + "/subjects/{subject}/diff", response_model=SchemaDiff)
async def diff_versions(
    subject: str,
    ctx: ClusterContext = Depends(get_cluster),
    from_: str = Query("1", alias="from"),
    to: str = Query("latest"),
) -> Any:
    return await get_schema_registry(ctx).diff(subject, parse_version(from_), parse_version(to))


@router.get(BASE + "/ids/{schema_id}", response_model=SchemaById)
async def get_schema_by_id(schema_id: int, ctx: ClusterContext = Depends(get_cluster)) -> Any:
    return await get_schema_registry(ctx).get_by_id(schema_id)
