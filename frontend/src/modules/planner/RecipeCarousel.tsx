/** M2: the recipes, as a scrolling strip of hero images. Drag one onto the calendar. */
import { useDraggable } from '@dnd-kit/core'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fileUrl, type RecipeSummary } from '../recipes/recipesApi'

export interface DragRecipe {
  slug: string
  title: string
  updated_at: string
}

export function RecipeCarousel({ recipes }: { recipes: RecipeSummary[] | null }) {
  const strip = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' })
  const shown = (recipes ?? []).filter((r) => r.title.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <section className="carousel" aria-label="Recipes">
      <div className="carousel-head">
        <h2>Recipes</h2>
        <input aria-label="Find a recipe" placeholder="Find…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="muted small hide-narrow">Drag a recipe onto a day</span>
        <span className="carousel-nav">
          <button aria-label="Scroll recipes left" onClick={() => scroll(-1)}>
            ‹
          </button>
          <button aria-label="Scroll recipes right" onClick={() => scroll(1)}>
            ›
          </button>
        </span>
      </div>
      {recipes === null ? (
        <p className="muted">Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="placeholder">
          No recipes yet. <Link to="/recipes/upload">Upload one</Link> to start planning.
        </p>
      ) : (
        <div className="carousel-strip" ref={strip}>
          {shown.map((r) => (
            <CarouselCard key={r.slug} recipe={r} />
          ))}
          {shown.length === 0 && <p className="muted">No recipes match “{filter}”.</p>}
        </div>
      )}
    </section>
  )
}

function CarouselCard({ recipe }: { recipe: RecipeSummary }) {
  const data: DragRecipe = { slug: recipe.slug, title: recipe.title, updated_at: recipe.updated_at }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `recipe:${recipe.slug}`, data })
  return (
    <div
      ref={setNodeRef}
      className={`carousel-card${isDragging ? ' dragging' : ''}`}
      {...listeners}
      {...attributes}
      aria-label={`${recipe.title}. Drag onto a day to plan it.`}
    >
      <img src={fileUrl(recipe, 'hero.jpg')} alt="" draggable={false} />
      <span>{recipe.title}</span>
    </div>
  )
}

export function RecipeDragPreview({ recipe }: { recipe: DragRecipe }) {
  return (
    <div className="carousel-card drag-preview">
      <img src={fileUrl(recipe, 'hero.jpg')} alt="" />
      <span>{recipe.title}</span>
    </div>
  )
}
