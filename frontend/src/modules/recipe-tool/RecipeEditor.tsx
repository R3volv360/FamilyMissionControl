/**
 * Create or edit a recipe (spec T1–T9), built for a phone first: one column, big targets, no drag and drop,
 * and a Save bar fixed to the bottom of the screen. Work in progress is kept as a draft on the device.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate } from 'react-router-dom'
import { useConfirm } from '../../shared/ConfirmDialog'
import { useToast } from '../../shared/Toast'
import { alreadyExists, errorMessage } from '../recipes/recipesApi'
import { draftKey, drafts } from './draftStore'
import {
  blankRecipe, emptyIngredient, emptyStep, fromServer, insertAfter, move, problems, remove, sameSection, toServer, update,
  type EditorState, type IngredientRow as Row, type StepCard as Step,
} from './editorState'
import { IngredientRow } from './IngredientRow'
import { PhotoPicker } from './PhotoPicker'
import { StepCard } from './StepCard'
import { toolApi } from './toolApi'

const DRAFT_DELAY_MS = 400

export function RecipeEditor({ slug }: { slug: string | null }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const key = draftKey(slug)

  const [state, setState] = useState<EditorState | null>(null)
  const [base, setBase] = useState<string | null>(null) // the stored recipe's updated_at
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [restored, setRestored] = useState<{ savedAt: number; stale: boolean } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null) // ingredient row showing its actions
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set()) // step ids
  const [focusId, setFocusId] = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const markDirty = (value: boolean) => {
    dirtyRef.current = value
    setDirty(value)
  }

  // ---- load: the saved draft if there is one, otherwise the stored recipe (or a blank one) ----
  const load = useCallback(
    (useDraft: boolean) =>
      Promise.all([useDraft ? drafts.get(key) : null, slug ? toolApi.load(slug) : null])
        .then(([draft, server]) => {
          const current = server?.updated_at ?? null
          setBase(current)
          if (draft) {
            setState(draft.state)
            setRestored({ savedAt: draft.savedAt, stale: !!slug && draft.base !== current })
            markDirty(true)
          } else {
            setState(server ? fromServer(server) : blankRecipe())
            setRestored(null)
            markDirty(false)
          }
        })
        .catch((e) => setLoadError(errorMessage(e))),
    [key, slug],
  )

  useEffect(() => {
    load(true)
  }, [load])

  // ---- keep the draft (T9) ----
  useEffect(() => {
    if (!dirty || !state) return
    const t = setTimeout(() => drafts.put(key, { state, savedAt: Date.now(), base }), DRAFT_DELAY_MS)
    return () => clearTimeout(t)
  }, [dirty, state, key, base])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({
      title: 'Discard unsaved changes?',
      message: 'Your changes to this recipe haven’t been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true,
    }).then(async (ok) => {
      if (!ok) return blocker.reset()
      await drafts.remove(key)
      markDirty(false)
      blocker.proceed()
    })
  }, [blocker, confirm, key])

  if (loadError)
    return (
      <section>
        <p>{loadError}</p>
        <Link to="/recipes">Back to Recipes</Link>
      </section>
    )
  if (!state) return <p className="muted">Loading…</p>

  // ---- changes ----
  const edit = (fn: (s: EditorState) => EditorState) => {
    setState((s) => (s ? fn(s) : s))
    markDirty(true)
  }
  const setIngredients = (fn: (rows: Row[]) => Row[]) => edit((s) => ({ ...s, ingredients: fn(s.ingredients) }))
  const setSteps = (fn: (steps: Step[]) => Step[]) => edit((s) => ({ ...s, steps: fn(s.steps) }))
  const onError = (message: string) => toast(message, 'error')

  const addIngredient = (cupboard: boolean, afterId: string | null = null) => {
    const row = emptyIngredient(cupboard)
    setIngredients((rows) => insertAfter(rows, afterId, row))
    setFocusId(row.id)
  }

  const nextRow = (row: Row) => {
    const section = state.ingredients.filter((r) => r.cupboard === row.cupboard)
    const after = section[section.findIndex((r) => r.id === row.id) + 1]
    if (after) setFocusId(after.id)
    else addIngredient(row.cupboard, row.id)
  }

  const removeStep = async (step: Step, number: number) => {
    const blank = !step.title.trim() && !step.text.trim() && step.photo.kind === 'none'
    if (
      !blank &&
      !(await confirm({
        title: `Remove step ${number}?`,
        message: step.title.trim() ? `“${step.title.trim()}” and its photo will be removed when you save.` : undefined,
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return
    setSteps((steps) => remove(steps, step.id))
  }

  const toggleStep = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const discardDraft = async () => {
    if (!(await confirm({ title: 'Discard your unsaved changes?', confirmLabel: 'Discard', danger: true }))) return
    await drafts.remove(key)
    await load(false)
  }

  const save = async (overwrite = false): Promise<void> => {
    const found = problems(state)
    setErrors(found)
    if (found.length) {
      topRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      return
    }
    setSaving(true)
    try {
      const { recipe, photos } = toServer(state)
      const res = await toolApi.save(recipe, photos, overwrite)
      markDirty(false)
      await drafts.remove(key)
      toast(`Saved ${res.recipe.title}`, 'success')
      navigate(`/recipes/${res.recipe.slug}`)
    } catch (e) {
      if (!overwrite && alreadyExists(e)) {
        const ok = await confirm({
          title: `Replace “${state.title.trim()}”?`,
          message: 'A recipe with this name is already in the app. Saving replaces it completely, photos included.',
          confirmLabel: 'Replace',
          danger: true,
        })
        if (ok) return save(true)
      } else {
        toast(errorMessage(e), 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const fileUrl = (name: string) => (slug ? `/api/recipes/${slug}/files/${name}?v=${encodeURIComponent(base ?? '')}` : null)
  const sections = [false, true].map((cupboard) => state.ingredients.filter((r) => r.cupboard === cupboard))
  const serves = parseInt(state.serves, 10)
  const allCollapsed = state.steps.length > 0 && state.steps.every((s) => collapsed.has(s.id))

  return (
    <div className="tool">
      <div ref={topRef} className="tool-head">
        <Link to={slug ? `/recipes/${slug}` : '/recipes'} className="back">
          ← {slug ? 'Recipe' : 'Recipes'}
        </Link>
        <h1>{slug ? 'Edit recipe' : 'New recipe'}</h1>
      </div>

      {restored && (
        <div className="notice" role="status">
          <span>
            Picked up your unsaved changes from {new Date(restored.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.
            {restored.stale && ' The recipe has been changed since; saving will replace that change.'}
          </span>
          <button type="button" onClick={discardDraft}>
            Discard changes
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="notice notice-error" role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <PhotoPicker
        variant="hero"
        photo={state.hero}
        keptUrl={fileUrl('hero.jpg')}
        label="Recipe photo"
        onChange={(hero) => edit((s) => ({ ...s, hero }))}
        onError={onError}
      />

      <section className="card">
        <div className="field">
          <label htmlFor="recipe-name">Name</label>
          <input
            id="recipe-name"
            value={state.title}
            placeholder="e.g. Mum's lasagne"
            autoCapitalize="sentences"
            enterKeyHint="next"
            aria-invalid={errors.length > 0 && !state.title.trim()}
            onChange={(e) => edit((s) => ({ ...s, title: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="recipe-subtitle">
            Subtitle <span className="muted">(optional)</span>
          </label>
          <input id="recipe-subtitle" value={state.subtitle} placeholder="e.g. with garlic bread" onChange={(e) => edit((s) => ({ ...s, subtitle: e.target.value }))} />
        </div>
        <div className="field">
          <span id="serves-label">Serves</span>
          <div className="stepper" role="group" aria-labelledby="serves-label">
            <button type="button" aria-label="Fewer servings" disabled={!(serves > 1)} onClick={() => edit((s) => ({ ...s, serves: String(Math.max(1, (parseInt(s.serves, 10) || 2) - 1)) }))}>
              −
            </button>
            <input
              aria-labelledby="serves-label"
              inputMode="numeric"
              value={state.serves}
              onChange={(e) => edit((s) => ({ ...s, serves: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
            />
            <button type="button" aria-label="More servings" disabled={serves >= 99} onClick={() => edit((s) => ({ ...s, serves: String(Math.min(99, (parseInt(s.serves, 10) || 0) + 1)) }))}>
              +
            </button>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="ingredients-heading">
        <h2 id="ingredients-heading">Ingredients</h2>
        {sections.map((rows, s) => (
          <div key={s} className="ing-section">
            {s === 1 && <h3>From the cupboard</h3>}
            {rows.length === 0 && (
              <p className="muted small">{s === 0 ? 'No ingredients yet.' : 'Salt, oil and other staples go here.'}</p>
            )}
            <ul className="ing-list">
              {rows.map((row, i) => (
                <IngredientRow
                  key={row.id}
                  row={row}
                  index={i + 1}
                  first={i === 0}
                  last={i === rows.length - 1}
                  expanded={expanded === row.id}
                  focus={focusId === row.id}
                  onChange={(patch) => setIngredients((list) => update(list, row.id, patch))}
                  onNext={() => nextRow(row)}
                  onToggle={() => setExpanded((x) => (x === row.id ? null : row.id))}
                  onMove={(by) => setIngredients((list) => move(list, row.id, by, sameSection))}
                  onRemove={() => setIngredients((list) => remove(list, row.id))}
                />
              ))}
            </ul>
            <button type="button" className="add-button" onClick={() => addIngredient(s === 1)}>
              + {s === 0 ? 'Add ingredient' : 'Add cupboard staple'}
            </button>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="method-heading">
        <div className="section-head">
          <h2 id="method-heading">Method</h2>
          {state.steps.length > 1 && (
            <button type="button" className="link-button" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(state.steps.map((s) => s.id)))}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
        {state.steps.length === 0 && <p className="muted small">No steps yet.</p>}
        <ol className="step-list">
          {state.steps.map((step, i) => (
            <StepCard
              key={step.id}
              step={step}
              number={i + 1}
              first={i === 0}
              last={i === state.steps.length - 1}
              collapsed={collapsed.has(step.id)}
              keptUrl={(from) => (from ? fileUrl(`s${from}.jpg`) : null)}
              onChange={(patch) => setSteps((steps) => update(steps, step.id, patch))}
              onToggle={() => toggleStep(step.id)}
              onMove={(by) => setSteps((steps) => move(steps, step.id, by))}
              onRemove={() => removeStep(step, i + 1)}
              onError={onError}
            />
          ))}
        </ol>
        <button type="button" className="add-button" onClick={() => setSteps((steps) => [...steps, emptyStep()])}>
          + Add step
        </button>
      </section>

      <div className="save-bar">
        <span className="muted small" aria-live="polite">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes yet'}
        </span>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </div>
  )
}
