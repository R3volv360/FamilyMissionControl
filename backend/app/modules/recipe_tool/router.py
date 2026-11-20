from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError

from app.core.deps import AppSettings, DbSession
from app.modules.recipe_tool import service
from app.modules.recipe_tool.schemas import EditorRecipe
from app.modules.recipes import service as recipes
from app.modules.recipes.schemas import RecipeSummary, StoreOut

router = APIRouter()


def _http(e: recipes.RecipeError) -> HTTPException:
    if isinstance(e, recipes.NotFound):
        return HTTPException(404, str(e))
    if isinstance(e, recipes.AlreadyExists):
        return HTTPException(409, {"message": str(e), "exists_in": e.where})
    return HTTPException(422 if isinstance(e, recipes.InvalidRecipe) else 400, str(e))


@router.get("/recipes/{slug}", response_model=EditorRecipe)
def load(slug: str, db: DbSession, settings: AppSettings):
    """A recipe as the tool edits it: plain text rows (T2)."""
    try:
        return service.load(db, settings, slug)
    except recipes.RecipeError as e:
        raise _http(e)


@router.post("/save", response_model=StoreOut)
async def save(
    request: Request,
    background: BackgroundTasks,
    db: DbSession,
    settings: AppSettings,
    recipe: Annotated[str, Form()],
    overwrite: Annotated[bool, Form()] = False,
    photos: Annotated[list[UploadFile], File()] = [],  # noqa: B006 (FastAPI copies defaults)
):
    """Save a new or edited recipe (T1/T2/T8): `recipe` is an EditorRecipe as JSON; `photos` are hero.jpg
    and step-<n>.jpg. Stored like an upload, then pushed to S3 in the background (as R2)."""
    try:
        rec = EditorRecipe.model_validate_json(recipe)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False))
    uploads = {PurePath(p.filename or "").name: await p.read() for p in photos}
    try:
        result = service.save(db, settings, rec, uploads, overwrite)
    except recipes.RecipeError as e:
        raise _http(e)
    result.recipe.s3_state, result.recipe.s3_error = "pending", None
    db.commit()
    background.add_task(recipes.background_upload, request.app.state.db, settings, result.recipe.slug)
    return StoreOut(recipe=RecipeSummary.model_validate(result.recipe), replaced=result.replaced,
                    warnings=result.warnings, ignored=result.ignored)
