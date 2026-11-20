"""Recipes: upload (R2), link ingredients to known items (R1), sync with S3 (R3/R4), hero images (R5)."""
import html
import io
import json
import logging
import re
import zipfile
from dataclasses import dataclass, field
from typing import Literal, Protocol

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.db import Database
from app.modules.items import service as items
from app.modules.recipes import repository as repo
from app.modules.recipes.models import Recipe, RecipeIngredient
from app.modules.recipes.repository import RecipeFiles
from app.modules.recipes.s3_repository import S3Store

log = logging.getLogger(__name__)

# ChopTilYouDrop/tools/upload_recipe.py's whitelist, minus card.pdf: the app prints recipes from their data
# (spec T10/T11), so a skill's PDF is skipped without comment.
FILE_RE = re.compile(r"recipe\.json|hero\.jpg|s\d+\.jpg")
SKIPPED = {"card.pdf"}
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# Trailing phrases that aren't part of an item's name: "Salt & pepper, to taste" -> "Salt & pepper"
SERVING_NOTE_RE = re.compile(r"[,(]?\s*\b(to taste|to serve|for serving|optional|for garnish)\)?\s*$", re.I)


class RecipeError(Exception):
    pass


class InvalidRecipe(RecipeError):
    pass


class NotFound(RecipeError):
    pass


class AlreadyExists(RecipeError):
    """The target already has this recipe; retry with overwrite=True after warning the user."""

    def __init__(self, slug: str, where: str):
        super().__init__(f'"{slug}" already exists in {where}')
        self.slug, self.where = slug, where


class SameTitle(RecipeError):
    """Another recipe (in a different folder) already has this title; retry with same_title_ok=True after
    warning the user."""

    def __init__(self, title: str, other_slug: str):
        super().__init__(f'There is already a recipe called "{title}"')
        self.title, self.other_slug = title, other_slug


class S3Error(RecipeError):
    pass


# ---- references to known items (registered with the items module) -------------------------------------


class _RecipeItemRefs:
    label = "recipes"

    def usage(self, db: Session, item_id: int) -> int:
        return repo.count_recipes_using_item(db, item_id)

    def reassign(self, db: Session, from_id: int, to_id: int) -> None:
        repo.reassign_item(db, from_id, to_id)

    def detach(self, db: Session, item_id: int) -> None:
        repo.unlink_item(db, item_id)


items.register_references(_RecipeItemRefs())


# ---- references to recipes from other modules (e.g. the Meal Planner) ----------------------------------
# Same pattern as items: modules that point at recipes register a provider, so this module can say what a
# delete would affect without importing them.


class RecipeReferences(Protocol):
    def usage(self, db: Session, recipe_id: int) -> dict[str, int]:
        """e.g. {"upcoming meals": 2, "past meals": 5}; zero counts may be left out."""


_recipe_refs: list[RecipeReferences] = []


def register_recipe_references(provider: RecipeReferences) -> None:
    _recipe_refs.append(provider)


def usage(db: Session, slug: str) -> dict[str, int]:
    recipe = get(db, slug)
    found: dict[str, int] = {}
    for p in _recipe_refs:
        found.update({k: v for k, v in p.usage(db, recipe.id).items() if v})
    return found


# ---- helpers -------------------------------------------------------------------------------------------


MAX_ZIP_BYTES = 200_000_000  # unpacked; a recipe folder is a few MB


def unpack_zip(data: bytes, zip_name: str) -> tuple[str, dict[str, bytes]]:
    """A recipe folder as a zip (the recipe-card skill's download): returns (folder name, files).

    The folder name is the zip's single top-level folder if it has one, otherwise the zip's own name.
    Only whitelisted files are read, and only from the top level or that one folder, so paths can't escape.
    """
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise InvalidRecipe(f"{zip_name} isn't a valid zip file")
    with z:
        members = [i for i in z.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
        tops = {i.filename.replace("\\", "/").split("/")[0] for i in members if "/" in i.filename.replace("\\", "/")}
        folder = tops.pop() if len(tops) == 1 and all("/" in i.filename.replace("\\", "/") for i in members) else ""
        files: dict[str, bytes] = {}
        total = 0
        for info in members:
            parts = info.filename.replace("\\", "/").split("/")
            name = parts[-1]
            if len(parts) > 2 or (len(parts) == 2 and parts[0] != folder) or not FILE_RE.fullmatch(name):
                continue
            total += info.file_size
            if total > MAX_ZIP_BYTES:
                raise InvalidRecipe(f"{zip_name} is too big to be a recipe folder")
            files[name] = z.read(info)
    return folder or re.sub(r"\.zip$", "", zip_name, flags=re.I), files


def slugify(folder_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", folder_name.lower()).strip("-")


def check_slug(slug: str) -> str:
    if not SLUG_RE.fullmatch(slug or ""):
        raise InvalidRecipe(f'"{slug}" is not a valid recipe folder name')
    return slug


def clean_text(raw: str) -> str:
    """Recipe text for display: markup and entities removed, whitespace collapsed (case kept)."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", raw or ""))).strip()


def item_name(raw: str) -> str:
    """The known-item name for an ingredient line: markup removed and serving notes dropped."""
    return SERVING_NOTE_RE.sub("", items.tidy_name(raw)).strip(" ,")


def parse_recipe_json(content: bytes) -> dict:
    try:
        data = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise InvalidRecipe(f"recipe.json isn't valid JSON: {e}")
    if not isinstance(data, dict):
        raise InvalidRecipe("recipe.json should be an object")
    if not isinstance(data.get("title"), str) or not data["title"].strip():
        raise InvalidRecipe("recipe.json has no title")
    ings = data.get("ingredients")
    if not isinstance(ings, list) or not all(isinstance(i, list) and len(i) >= 2 for i in ings):
        raise InvalidRecipe("recipe.json ingredients should be a list of [qty, name, allergens]")
    steps = data.get("steps")
    if not isinstance(steps, list) or not all(isinstance(s, list) and len(s) == 2 for s in steps):
        raise InvalidRecipe("recipe.json steps should be a list of [title, [lines]]")
    pantry = data.get("pantry", [])
    if not isinstance(pantry, list) or not all(isinstance(p, list) and len(p) >= 2 for p in pantry):
        raise InvalidRecipe("recipe.json pantry should be a list of [qty, name]")
    return data


def missing_photos(data: dict, names: set[str]) -> list[str]:
    wanted = ["hero.jpg"] + [f"s{i}.jpg" for i in range(1, len(data["steps"]) + 1)]
    return [n for n in wanted if n not in names]


# ---- reading -------------------------------------------------------------------------------------------


def list_recipes(db: Session) -> list[Recipe]:
    return repo.list_all(db)


def get(db: Session, slug: str) -> Recipe:
    recipe = repo.get(db, slug)
    if not recipe:
        raise NotFound(f'No recipe "{slug}"')
    return recipe


def read_files(settings: Settings, slug: str) -> dict[str, bytes]:
    """A stored recipe's files by name (for the Recipe Tool, which rebuilds the folder on save)."""
    return RecipeFiles(settings.recipes_dir).read_all(check_slug(slug))


def file_path(settings: Settings, slug: str, name: str):
    """Path to one of a recipe's files (hero.jpg, s1.jpg…), or None if it isn't there (R5)."""
    check_slug(slug)
    if not FILE_RE.fullmatch(name):
        return None
    path = RecipeFiles(settings.recipes_dir).dir(slug) / name
    return path if path.is_file() else None


# ---- storing (upload R2, sync down R4) -----------------------------------------------------------------


@dataclass
class StoreResult:
    recipe: Recipe
    replaced: bool
    warnings: list[str] = field(default_factory=list)
    ignored: list[str] = field(default_factory=list)


def store(db: Session, settings: Settings, slug: str, files: dict[str, bytes], overwrite: bool,
          same_title_ok: bool = True) -> StoreResult:
    """Save a recipe folder locally and (re)build its ingredient links to known items (R1).

    With same_title_ok=False (uploads), a recipe in another folder with the same title raises SameTitle.

    `files` maps file names to contents; names outside the whitelist are ignored. Doesn't commit.
    """
    check_slug(slug)
    kept = {n: c for n, c in files.items() if FILE_RE.fullmatch(n)}
    ignored = sorted(n for n in files if n not in kept and n not in SKIPPED)
    if "recipe.json" not in kept:
        raise InvalidRecipe("The folder has no recipe.json")
    data = parse_recipe_json(kept["recipe.json"])

    recipe = repo.get(db, slug)
    if recipe and not overwrite:
        raise AlreadyExists(slug, "the app")
    if not same_title_ok and (other := repo.other_with_title(db, clean_text(data["title"]), slug)):
        raise SameTitle(other.title, other.slug)

    replaced = recipe is not None
    if recipe is None:
        recipe = Recipe(slug=slug)
    else:
        repo.clear_ingredients(db, recipe)
    recipe.title = clean_text(data["title"])
    recipe.subtitle = clean_text(data.get("subtitle") or "")
    recipe.serves = data["serves"] if isinstance(data.get("serves"), int) else None
    recipe.data = data
    repo.save(db, recipe)
    _link_ingredients(db, recipe, data)

    RecipeFiles(settings.recipes_dir).replace(slug, kept)
    warnings = []
    if missing := missing_photos(data, set(kept)):
        warnings.append(f"Missing photos: {', '.join(missing)}")
    return StoreResult(recipe, replaced, warnings, ignored)


def _link_ingredients(db: Session, recipe: Recipe, data: dict) -> None:
    lines = [("ingredients", row) for row in data["ingredients"]] + [("pantry", row) for row in data.get("pantry", [])]
    rows = []
    for pos, (section, row) in enumerate(lines):
        qty, raw_name = str(row[0] or "").strip(), str(row[1] or "")
        name = clean_text(raw_name)
        if not name:
            continue
        linked = item_name(raw_name)
        item = items.get_or_create(db, linked)[0] if linked else None
        rows.append(RecipeIngredient(
            position=pos, section=section, qty=qty, name=name,
            allergens=str(row[2]) if section == "ingredients" and len(row) > 2 and row[2] else "",
            item_id=item.id if item else None,
        ))
    recipe.ingredients = rows
    db.flush()


# ---- S3 (R2 upload, R3 status, R4 actions) -------------------------------------------------------------


def _store_s3(settings: Settings) -> S3Store:
    if not settings.s3_bucket:
        raise S3Error("No S3 bucket is set: set MC_S3_BUCKET in backend\\.env")
    try:
        return S3Store(settings)
    except Exception as e:  # e.g. the configured AWS profile doesn't exist
        raise S3Error(f"S3: {e}") from e


def _s3_call(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # botocore raises many types; surface them all the same way
        log.exception("S3 call failed")
        raise S3Error(f"S3: {e}") from e


def _update_index(s3: S3Store, slug: str, title: str | None) -> None:
    """Add/refresh (title given) or remove (title None) a recipe in index.json, keeping spoken names/aliases."""
    index = s3.read_index()
    old = next((r for r in index if r.get("slug") == slug), None)
    index = [r for r in index if r.get("slug") != slug]
    if title is not None:
        index.append({
            "slug": slug,
            "title": title,
            "spoken": (old or {}).get("spoken") or title.lower(),
            "aliases": (old or {}).get("aliases") or [],
        })
    s3.write_index(index)


def push_to_s3(settings: Settings, slug: str, title: str) -> None:
    s3 = _store_s3(settings)
    files = RecipeFiles(settings.recipes_dir).read_all(slug)
    _s3_call(s3.upload, slug, files)
    _s3_call(_update_index, s3, slug, title)


def background_upload(database: Database, settings: Settings, slug: str) -> None:
    """Runs after an upload response (R2): push the recipe to S3, recording progress on the recipe."""
    with database.sessions() as db:
        recipe = repo.get(db, slug)
        if not recipe:
            return
        recipe.s3_state, recipe.s3_error = "uploading", None
        db.commit()
        try:
            push_to_s3(settings, slug, recipe.title)
            recipe.s3_state = "done"
        except Exception as e:
            recipe.s3_state, recipe.s3_error = "failed", str(e)
        db.commit()


SyncState = Literal["both", "app", "s3"]


@dataclass
class SyncRow:
    slug: str
    title: str
    state: SyncState


def sync_status(db: Session, settings: Settings) -> list[SyncRow]:
    """Every recipe in the app or S3, marked in both / app only / S3 only (R3)."""
    s3 = _store_s3(settings)
    remote = _s3_call(s3.list_slugs)
    index_titles = {r.get("slug"): r.get("title") for r in _s3_call(s3.read_index)}
    local = {r.slug: r.title for r in repo.list_all(db)}
    rows = []
    for slug in local.keys() | remote:
        state: SyncState = "both" if slug in local and slug in remote else "app" if slug in local else "s3"
        title = local.get(slug) or index_titles.get(slug) or slug.replace("-", " ").capitalize()
        rows.append(SyncRow(slug, title, state))
    return sorted(rows, key=lambda r: r.title.lower())


def sync_up(db: Session, settings: Settings, slug: str, overwrite: bool) -> None:
    recipe = get(db, slug)
    s3 = _store_s3(settings)
    if not overwrite and slug in _s3_call(s3.list_slugs):
        raise AlreadyExists(slug, "S3")
    push_to_s3(settings, slug, recipe.title)
    recipe.s3_state, recipe.s3_error = "done", None


def sync_down(db: Session, settings: Settings, slug: str, overwrite: bool) -> StoreResult:
    check_slug(slug)
    if not overwrite and repo.get(db, slug):
        raise AlreadyExists(slug, "the app")
    files = _s3_call(_store_s3(settings).download, slug)
    if not files:
        raise NotFound(f'"{slug}" isn\'t in S3')
    result = store(db, settings, slug, files, overwrite=True)
    result.recipe.s3_state, result.recipe.s3_error = "done", None
    return result


Where = Literal["app", "s3", "both"]


def delete(db: Session, settings: Settings, slug: str, where: Where) -> None:
    check_slug(slug)
    if where in ("s3", "both"):
        s3 = _store_s3(settings)
        _s3_call(s3.delete, slug)
        _s3_call(_update_index, s3, slug, None)
        if (recipe := repo.get(db, slug)) and where == "s3":
            recipe.s3_state = None
    if where in ("app", "both"):
        recipe = repo.get(db, slug)
        if not recipe and where == "app":
            raise NotFound(f'No recipe "{slug}" in the app')
        if recipe:
            repo.delete_recipe(db, recipe)
        RecipeFiles(settings.recipes_dir).delete(slug)
