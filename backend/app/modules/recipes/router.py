from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response

from app.core import aws
from app.core.deps import AppSettings, DbSession
from app.modules.recipes import service
from app.modules.recipes.repository import RecipeFiles
from app.modules.recipes.schemas import AwsStatusOut, CertOut, RecipeDetail, RecipeSummary, StoreOut, SyncRowOut

router = APIRouter()

PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#d9ded9"/>'
    '<path d="M150 190h100M170 160a30 30 0 0 1 60 0" stroke="#8a948e" stroke-width="10" fill="none" '
    'stroke-linecap="round"/></svg>'
)


def _http(e: service.RecipeError) -> HTTPException:
    if isinstance(e, service.NotFound):
        return HTTPException(404, str(e))
    if isinstance(e, service.InvalidRecipe):
        return HTTPException(422, str(e))
    if isinstance(e, service.AlreadyExists):
        return HTTPException(409, {"message": str(e), "exists_in": e.where})
    if isinstance(e, service.SameTitle):
        return HTTPException(409, {"message": str(e), "same_title": e.other_slug})
    if isinstance(e, service.S3Error):
        return HTTPException(502, str(e))
    return HTTPException(400, str(e))


def _store_out(r: service.StoreResult) -> StoreOut:
    return StoreOut(recipe=RecipeSummary.model_validate(r.recipe), replaced=r.replaced,
                    warnings=r.warnings, ignored=r.ignored)


@router.get("", response_model=list[RecipeSummary])
def list_recipes(db: DbSession):
    return service.list_recipes(db)


# Sync routes are declared before /{slug} so "sync" isn't taken for a slug.
@router.get("/aws-status", response_model=AwsStatusOut)
def aws_status(settings: AppSettings):
    """A6/A7: can the app reach the recipe bucket, and is the server's certificate close to expiring?"""
    st = aws.check(settings)
    cert = CertOut(subject=st.cert.subject, expires=st.cert.expires, days_left=st.cert.days_left) if st.cert else None
    return AwsStatusOut(ok=st.ok, message=st.message, profile=st.profile, identity=st.identity, cert=cert,
                        cert_warning=st.cert_warning)


@router.get("/sync", response_model=list[SyncRowOut])
def sync_status(db: DbSession, settings: AppSettings):
    try:
        return service.sync_status(db, settings)
    except service.RecipeError as e:
        raise _http(e)


@router.post("/sync/{slug}/up", status_code=204)
def sync_up(slug: str, db: DbSession, settings: AppSettings, overwrite: bool = False):
    try:
        service.sync_up(db, settings, slug, overwrite)
    except service.RecipeError as e:
        raise _http(e)
    db.commit()


@router.post("/sync/{slug}/down", response_model=StoreOut)
def sync_down(slug: str, db: DbSession, settings: AppSettings, overwrite: bool = False):
    try:
        result = service.sync_down(db, settings, slug, overwrite)
    except service.RecipeError as e:
        raise _http(e)
    db.commit()
    return _store_out(result)


@router.post("/upload", response_model=StoreOut)
async def upload(
    request: Request,
    background: BackgroundTasks,
    db: DbSession,
    settings: AppSettings,
    files: Annotated[list[UploadFile], File()],
    folder: Annotated[str, Form()] = "",
    overwrite: Annotated[bool, Form()] = False,
    same_title_ok: Annotated[bool, Form()] = False,
):
    """R2: upload a recipe folder (as produced by the recipe-card skill): its files, or the folder as one zip.
    Saved locally, then pushed to S3 in the background. The folder's name becomes the slug: `folder` if
    given, otherwise the zip's folder or file name. A recipe in another folder with the same title is refused
    (409, `same_title`) unless same_title_ok, so the user is asked first."""
    contents = {PurePath((f.filename or "").replace("\\", "/")).name: await f.read() for f in files}
    try:
        zips = [n for n in contents if n.lower().endswith(".zip")]
        if len(contents) == 1 and zips:
            zip_folder, contents = service.unpack_zip(contents[zips[0]], zips[0])
            folder = folder or zip_folder
        slug = service.slugify(folder)
        if not slug:
            raise service.InvalidRecipe("Give the recipe folder a name")
        result = service.store(db, settings, slug, contents, overwrite, same_title_ok)
    except service.RecipeError as e:
        raise _http(e)
    result.recipe.s3_state, result.recipe.s3_error = "pending", None
    db.commit()
    background.add_task(service.background_upload, request.app.state.db, settings, result.recipe.slug)
    return _store_out(result)


@router.get("/{slug}", response_model=RecipeDetail)
def get_recipe(slug: str, db: DbSession, settings: AppSettings):
    try:
        r = service.get(db, slug)
    except service.RecipeError as e:
        raise _http(e)
    return RecipeDetail(
        **RecipeSummary.model_validate(r).model_dump(),
        data=r.data,
        ingredients=r.ingredients,
        files=RecipeFiles(settings.recipes_dir).list(slug),
    )


@router.get("/{slug}/usage")
def recipe_usage(slug: str, db: DbSession) -> dict[str, int]:
    """What else uses this recipe, e.g. {"upcoming meals": 2, "past meals": 5}, for the delete warning."""
    try:
        return service.usage(db, slug)
    except service.RecipeError as e:
        raise _http(e)


@router.post("/{slug}/s3-upload", status_code=202)
def retry_s3_upload(slug: str, request: Request, background: BackgroundTasks, db: DbSession, settings: AppSettings):
    """Retry the background S3 upload after a failure."""
    try:
        recipe = service.get(db, slug)
    except service.RecipeError as e:
        raise _http(e)
    recipe.s3_state, recipe.s3_error = "pending", None
    db.commit()
    background.add_task(service.background_upload, request.app.state.db, settings, slug)


@router.get("/{slug}/files/{name}")
def get_file(slug: str, name: str, settings: AppSettings):
    """R5: a recipe's photos. A missing hero image gets a placeholder so cards always have a picture."""
    try:
        path = service.file_path(settings, slug, name)
    except service.RecipeError as e:
        raise _http(e)
    if path:
        return FileResponse(path, headers={"Cache-Control": "no-cache"})
    if name == "hero.jpg":
        return Response(PLACEHOLDER_SVG, media_type="image/svg+xml")
    raise HTTPException(404, "No such file")


@router.delete("/{slug}", status_code=204)
def delete(slug: str, db: DbSession, settings: AppSettings, where: service.Where = "app"):
    try:
        service.delete(db, settings, slug, where)
    except service.RecipeError as e:
        raise _http(e)
    db.commit()
