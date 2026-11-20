"""Recipe Tool (spec T1–T9): create and edit recipes in the app.

Recipes stay in the recipe-card skill's `recipe.json` shape, saved through the Recipes module's service, so
the item links (R1), the Meal Planner, S3 and Alexa all see them exactly as an uploaded recipe. This module
owns no tables; it converts between that shape and the tool's plain-text rows.
"""
import html
import json

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.recipe_tool.schemas import EditorIngredient, EditorRecipe, EditorStep
from app.modules.recipes import service as recipes

MAX_PHOTO_BYTES = 15_000_000  # the browser shrinks photos first (T7); this only stops mistakes
JPEG_MAGIC = b"\xff\xd8\xff"


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


# ---- loading -------------------------------------------------------------------------------------------


def load(db: Session, settings: Settings, slug: str) -> EditorRecipe:
    recipe = recipes.get(db, slug)
    data = recipe.data
    names = set(recipes.read_files(settings, slug))

    def ingredient(row: list, cupboard: bool) -> EditorIngredient:
        return EditorIngredient(
            qty=str(row[0] or "").strip(),
            name=recipes.clean_text(str(row[1] or "")),
            cupboard=cupboard,
            allergens="" if cupboard or len(row) < 3 else str(row[2] or ""),
        )

    steps = []
    for n, (title, lines) in enumerate(data.get("steps", []), start=1):
        has_photo = f"s{n}.jpg" in names
        steps.append(EditorStep(
            title=recipes.clean_text(str(title or "")),
            text="\n".join(recipes.clean_text(str(line)) for line in lines or []),
            photo="keep" if has_photo else "none",
            photo_from=n if has_photo else None,
        ))
    return EditorRecipe(
        slug=recipe.slug,
        title=recipe.title,
        subtitle=recipe.subtitle,
        serves=recipe.serves,
        hero="keep" if "hero.jpg" in names else "none",
        ingredients=[ingredient(r, False) for r in data.get("ingredients", [])]
        + [ingredient(r, True) for r in data.get("pantry", [])],
        steps=steps,
        updated_at=recipe.updated_at,
    )


# ---- saving --------------------------------------------------------------------------------------------


def _check_photo(name: str, content: bytes) -> bytes:
    if len(content) > MAX_PHOTO_BYTES:
        raise recipes.InvalidRecipe(f"{name} is too big")
    if not content.startswith(JPEG_MAGIC):
        raise recipes.InvalidRecipe(f"{name} isn't a JPEG photo")
    return content


def _keep_markup(original: dict) -> dict[str, str]:
    """Plain text -> the original line, so lines that weren't changed keep their <b>bold</b> ingredient names."""
    found: dict[str, str] = {}
    for title, lines in original.get("steps", []):
        for raw in [title, *(lines or [])]:
            found.setdefault(recipes.clean_text(str(raw)), str(raw))
    for row in original.get("ingredients", []) + original.get("pantry", []):
        found.setdefault(recipes.clean_text(str(row[1] or "")), str(row[1] or ""))
    return found


def build_json(rec: EditorRecipe, original: dict) -> dict:
    """recipe.json for an edited recipe. Fields the tool doesn't show (chips, nutrition, utensils…) are kept."""
    markup = _keep_markup(original)

    def text(plain: str) -> str:
        plain = " ".join(plain.split())
        return markup.get(plain) or html.escape(plain, quote=False)

    data = dict(original)
    data["title"] = " ".join(rec.title.split())
    data["subtitle"] = " ".join(rec.subtitle.split())
    if rec.serves is None:
        data.pop("serves", None)
    else:
        data["serves"] = rec.serves
    rows = [i for i in rec.ingredients if i.name.strip()]
    data["ingredients"] = [[i.qty.strip(), text(i.name), i.allergens.strip()] for i in rows if not i.cupboard]
    data["pantry"] = [[i.qty.strip(), text(i.name)] for i in rows if i.cupboard]
    data["steps"] = [[text(s.title), [text(line) for line in _lines(s.text)]] for _, s in _kept_steps(rec)]
    return data


def _kept_steps(rec: EditorRecipe) -> list[tuple[int, EditorStep]]:
    """(position in the editor, step) for steps with something in them; blank steps are dropped."""
    return [(n, s) for n, s in enumerate(rec.steps, start=1) if s.title.strip() or s.text.strip() or s.photo != "none"]


def build_files(rec: EditorRecipe, data: dict, old_files: dict[str, bytes], photos: dict[str, bytes]) -> dict[str, bytes]:
    """The recipe's whole folder: recipe.json, hero.jpg and s1.jpg… renumbered to the steps' new order.

    `photos` are the uploads: "hero.jpg" and "step-<n>.jpg", n being the step's position in `rec.steps`.
    """
    files = {"recipe.json": json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")}

    def pick(action: str, kept_name: str | None, upload_name: str) -> bytes | None:
        if action == "new":
            if upload_name not in photos:
                raise recipes.InvalidRecipe(f"The photo {upload_name} didn't arrive; try saving again")
            return _check_photo(upload_name, photos[upload_name])
        if action == "keep":
            if not kept_name or kept_name not in old_files:
                raise recipes.InvalidRecipe("A photo being kept is no longer there; reload the recipe")
            return old_files[kept_name]
        return None

    if hero := pick(rec.hero, "hero.jpg", "hero.jpg"):
        files["hero.jpg"] = hero
    for new_n, (position, step) in enumerate(_kept_steps(rec), start=1):
        old_name = f"s{step.photo_from}.jpg" if step.photo_from else None
        if photo := pick(step.photo, old_name, f"step-{position}.jpg"):
            files[f"s{new_n}.jpg"] = photo
    return files


def save(db: Session, settings: Settings, rec: EditorRecipe, photos: dict[str, bytes],
         overwrite: bool = False) -> recipes.StoreResult:
    """Save a new or edited recipe (T1/T2/T8). Doesn't commit; the caller starts the S3 upload.

    A new recipe's folder name comes from its title. If that recipe already exists, AlreadyExists is raised
    unless `overwrite` (after warning the user); the new recipe then replaces it completely.
    """
    title = " ".join(rec.title.split())
    if not title:
        raise recipes.InvalidRecipe("Give the recipe a name")
    if rec.slug:
        recipe = recipes.get(db, rec.slug)
        slug, original, old_files = recipe.slug, recipe.data, recipes.read_files(settings, recipe.slug)
    else:
        slug = recipes.slugify(title)
        if not slug:
            raise recipes.InvalidRecipe("The name needs at least one letter or number")
        original, old_files = {}, {}
        if rec.hero == "keep" or any(s.photo == "keep" for s in rec.steps):
            raise recipes.InvalidRecipe("A new recipe has no photos to keep")
    data = build_json(rec, original)
    files = build_files(rec, data, old_files, photos)
    result = recipes.store(db, settings, slug, files, overwrite=bool(rec.slug) or overwrite)
    result.warnings = []  # "missing photos" is normal here: photos are optional in the tool
    return result
