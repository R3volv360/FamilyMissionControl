"""Storage for recipes: database rows plus the recipe folders under data/recipes/<slug>/. No business rules."""
import shutil
import uuid
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.modules.recipes.models import Recipe, RecipeIngredient

# ---- database ------------------------------------------------------------------------------------------


def get(db: Session, slug: str) -> Recipe | None:
    return db.scalar(select(Recipe).where(Recipe.slug == slug))


def other_with_title(db: Session, title: str, slug: str) -> Recipe | None:
    """Another recipe (not `slug`) with this title, ignoring case."""
    stmt = select(Recipe).where(func.lower(Recipe.title) == title.lower(), Recipe.slug != slug)
    return db.scalars(stmt).first()


def list_all(db: Session) -> list[Recipe]:
    return list(db.scalars(select(Recipe).order_by(func.lower(Recipe.title))))


def all_slugs(db: Session) -> set[str]:
    return set(db.scalars(select(Recipe.slug)))


def save(db: Session, recipe: Recipe) -> Recipe:
    db.add(recipe)
    db.flush()
    return recipe


def delete_recipe(db: Session, recipe: Recipe) -> None:
    db.delete(recipe)
    db.flush()


def count_recipes_using_item(db: Session, item_id: int) -> int:
    stmt = select(func.count(func.distinct(RecipeIngredient.recipe_id))).where(RecipeIngredient.item_id == item_id)
    return db.scalar(stmt) or 0


def reassign_item(db: Session, from_id: int, to_id: int) -> None:
    db.execute(update(RecipeIngredient).where(RecipeIngredient.item_id == from_id).values(item_id=to_id))


def unlink_item(db: Session, item_id: int) -> None:
    db.execute(update(RecipeIngredient).where(RecipeIngredient.item_id == item_id).values(item_id=None))


def clear_ingredients(db: Session, recipe: Recipe) -> None:
    db.execute(delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id))
    db.expire(recipe, ["ingredients"])


# ---- files ---------------------------------------------------------------------------------------------


class RecipeFiles:
    def __init__(self, root: Path):
        self.root = root

    def dir(self, slug: str) -> Path:
        return self.root / slug

    def exists(self, slug: str) -> bool:
        return self.dir(slug).is_dir()

    def list(self, slug: str) -> list[str]:
        d = self.dir(slug)
        return sorted(p.name for p in d.iterdir() if p.is_file()) if d.is_dir() else []

    def read_all(self, slug: str) -> dict[str, bytes]:
        d = self.dir(slug)
        return {name: (d / name).read_bytes() for name in self.list(slug)}

    def replace(self, slug: str, files: dict[str, bytes]) -> None:
        """Write the folder's files, replacing whatever was there (written to a temp folder, then swapped)."""
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f".tmp-{slug}-{uuid.uuid4().hex[:8]}"
        tmp.mkdir()
        try:
            for name, content in files.items():
                (tmp / name).write_bytes(content)
            target = self.dir(slug)
            if target.exists():
                old = self.root / f".old-{slug}-{uuid.uuid4().hex[:8]}"
                target.rename(old)
                tmp.rename(target)
                shutil.rmtree(old, ignore_errors=True)
            else:
                tmp.rename(target)
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)

    def delete(self, slug: str) -> None:
        shutil.rmtree(self.dir(slug), ignore_errors=True)
