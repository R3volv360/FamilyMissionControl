/**
 * R2: upload a recipe by pointing the app at the folder the recipe-card skill produces
 * (recipe.json, hero.jpg, s1.jpg…). It's saved in the app, then copied to S3 in the background.
 * Phones that can't pick a folder can pick the files instead and give the folder name.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useConfirm } from '../../shared/ConfirmDialog'
import { useToast } from '../../shared/Toast'
import { alreadyExists, errorMessage, recipesApi, sameTitleAs, slugify, type RecipeJson } from './recipesApi'

const FILE_RE = /^(recipe\.json|hero\.jpg|s\d+\.jpg|card\.pdf)$/

interface Picked {
  files: File[]
  folder: string
  recipe: RecipeJson | null
  error: string | null
  zip?: File // the recipe-card skill's download; the server unpacks it
}

const isZip = (f: File) => /\.zip$/i.test(f.name)

export function UploadPage() {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const toast = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '') // not in React's typings
  }, [])

  const onPick = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    if (files.length === 1 && isZip(files[0])) {
      // The folder name comes from inside the zip unless one is typed here.
      setPicked({ files, recipe: null, error: null, folder: '', zip: files[0] })
      return
    }
    // webkitRelativePath is "folder/recipe.json" when a folder was picked
    const folderName = files[0].webkitRelativePath.split('/')[0] ?? ''
    const recipeFile = files.find((f) => f.name === 'recipe.json')
    let recipe: RecipeJson | null = null
    let error: string | null = null
    if (!recipeFile) error = 'There is no recipe.json in what you picked.'
    else {
      try {
        recipe = JSON.parse(await recipeFile.text())
      } catch {
        error = "recipe.json isn't valid JSON."
      }
    }
    setPicked({ files, recipe, error, folder: slugify(folderName || recipe?.title || '') })
  }

  const upload = async (overwrite = false, sameTitleOk = false): Promise<void> => {
    if (!picked || (!picked.zip && (!picked.recipe || !picked.folder))) return
    setBusy(true)
    const name = picked.recipe?.title ?? picked.zip?.name ?? 'this recipe'
    try {
      const files = picked.zip ? [picked.zip] : picked.files.filter((f) => FILE_RE.test(f.name))
      const res = await recipesApi.upload(picked.folder, files, overwrite, sameTitleOk)
      toast(`${res.recipe.title} ${res.replaced ? 'replaced' : 'added'}`, 'success')
      for (const w of res.warnings) toast(w)
      navigate(`/recipes/${res.recipe.slug}`)
    } catch (e) {
      if (alreadyExists(e)) {
        setBusy(false)
        const ok = await confirm({
          title: `Replace “${name}”?`,
          message: 'This recipe is already in the app. Uploading will replace it, and its S3 copy.',
          confirmLabel: 'Replace',
          danger: true,
        })
        if (ok) return upload(true, sameTitleOk)
      } else if (sameTitleAs(e)) {
        setBusy(false)
        const other = sameTitleAs(e)
        const ok = await confirm({
          title: `There's already a recipe called “${name}”`,
          message: `It's in the folder “${other}”. This upload's folder has a different name, so you'd have two recipes called “${name}”. To replace the existing one instead, cancel and set the folder name to “${other}”.`,
          confirmLabel: 'Add a second one',
        })
        if (ok) return upload(overwrite, true)
      } else toast(errorMessage(e), 'error')
    }
    setBusy(false)
  }

  const names = new Set(picked?.files.map((f) => f.name))
  const stepCount = picked?.recipe?.steps?.length ?? 0
  const missing = picked?.recipe
    ? ['hero.jpg', ...Array.from({ length: stepCount }, (_, i) => `s${i + 1}.jpg`)].filter((n) => !names.has(n))
    : []
  const ignored = picked?.files.filter((f) => !FILE_RE.test(f.name)).map((f) => f.name) ?? []

  return (
    <section>
      <Link to="/recipes" className="back">
        ← Recipes
      </Link>
      <h1>Upload a recipe</h1>
      <p className="muted">
        Pick the recipe zip or folder from the recipe-card skill: <code>recipe.json</code>, <code>hero.jpg</code> and
        the step photos.
      </p>

      <div className="actions">
        <label className="button btn-primary">
          Choose zip
          <input type="file" hidden accept=".zip,application/zip" onChange={(e) => onPick(e.target.files)} />
        </label>
        <label className="button">
          Choose folder
          <input ref={folderInput} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
        </label>
        <label className="button">
          Choose files
          <input type="file" multiple hidden accept=".json,.jpg,.jpeg,.pdf,.zip" onChange={(e) => onPick(e.target.files)} />
        </label>
      </div>

      {picked && (
        <div className="card">
          {picked.zip ? (
            <>
              <h2>{picked.zip.name}</h2>
              <p className="muted">The recipe is read from the zip when you upload it.</p>
              <label className="field">
                Folder name <span className="muted small">(optional: normally taken from the zip)</span>
                <input
                  value={picked.folder}
                  placeholder="from the zip"
                  onChange={(e) => setPicked({ ...picked, folder: slugify(e.target.value) })}
                />
              </label>
              <button className="btn-primary" disabled={busy} onClick={() => upload()}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </>
          ) : picked.error ? (
            <p className="error">{picked.error}</p>
          ) : (
            <>
              <h2>{picked.recipe?.title}</h2>
              {picked.recipe?.subtitle && <p className="muted">{picked.recipe.subtitle}</p>}
              <label className="field">
                Folder name
                <input value={picked.folder} onChange={(e) => setPicked({ ...picked, folder: slugify(e.target.value) })} />
              </label>
              <ul className="checklist">
                <li className="ok">recipe.json</li>
                <li className={names.has('hero.jpg') ? 'ok' : 'warn'}>hero.jpg</li>
                <li className={missing.length ? 'warn' : 'ok'}>
                  {stepCount - missing.filter((m) => m !== 'hero.jpg').length} of {stepCount} step photos
                </li>
              </ul>
              {missing.length > 0 && <p className="muted small">Missing: {missing.join(', ')}. The recipe still uploads.</p>}
              {ignored.length > 0 && <p className="muted small">Ignored: {ignored.join(', ')}</p>}
              <button className="btn-primary" disabled={busy || !picked.folder} onClick={() => upload()}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
