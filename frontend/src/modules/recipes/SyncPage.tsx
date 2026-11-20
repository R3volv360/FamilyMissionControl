/**
 * R3/R4: press Sync to list every recipe in the app and in S3, then act on each one.
 * Nothing syncs automatically. Deletes and overwrites ask first.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useConfirm } from '../../shared/ConfirmDialog'
import { useToast } from '../../shared/Toast'
import { AwsStatusBar } from './AwsStatusBar'
import { errorMessage, recipesApi, type DeleteWhere, type SyncRow, type SyncState } from './recipesApi'
import { useConfirmDelete, WHERE_LABEL } from './useConfirmDelete'

const STATE_LABEL: Record<SyncState, string> = { both: 'In both', app: 'App only', s3: 'S3 only' }

export function SyncPage() {
  const [rows, setRows] = useState<SyncRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const toast = useToast()
  const confirmDelete = useConfirmDelete()

  const refresh = async () => {
    setLoading(true)
    try {
      setRows(await recipesApi.syncStatus())
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    setLoading(false)
  }

  const run = async (row: SyncRow, action: () => Promise<unknown>, done: string) => {
    setBusy(row.slug)
    try {
      await action()
      toast(done, 'success')
      await refresh()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    setBusy(null)
  }

  const syncUp = async (row: SyncRow) => {
    const overwrite = row.state === 'both'
    if (overwrite && !(await confirm({
      title: `Replace “${row.title}” in S3?`,
      message: "The S3 copy will be replaced with the app's copy.",
      confirmLabel: 'Replace in S3',
      danger: true,
    }))) return
    run(row, () => recipesApi.syncUp(row.slug, overwrite), `${row.title} synced up to S3`)
  }

  const syncDown = async (row: SyncRow) => {
    const overwrite = row.state === 'both'
    if (overwrite && !(await confirm({
      title: `Replace “${row.title}” in the app?`,
      message: "The app's copy will be replaced with the S3 copy.",
      confirmLabel: 'Replace in app',
      danger: true,
    }))) return
    run(row, () => recipesApi.syncDown(row.slug, overwrite), `${row.title} synced down to the app`)
  }

  const remove = async (row: SyncRow, where: DeleteWhere) => {
    if (await confirmDelete(row.slug, row.title, where)) run(row, () => recipesApi.delete(row.slug, where), `${row.title} deleted from ${WHERE_LABEL[where]}`)
  }

  const deleteOptions = (state: SyncState): DeleteWhere[] =>
    state === 'both' ? ['app', 's3', 'both'] : state === 'app' ? ['app'] : ['s3']

  return (
    <section>
      <Link to="/recipes" className="back">
        ← Recipes
      </Link>
      <div className="page-head">
        <h1>Sync with S3</h1>
        <button className="btn-primary" onClick={refresh} disabled={loading}>
          {loading ? 'Checking…' : rows ? 'Sync again' : 'Sync'}
        </button>
      </div>
      <p className="muted">Lists every recipe in the app and in the S3 bucket. Nothing changes until you choose an action.</p>
      <AwsStatusBar />

      {rows && rows.length === 0 && <p className="placeholder">No recipes in the app or S3.</p>}
      {rows && rows.length > 0 && (
        <ul className="rows sync-rows">
          {rows.map((row) => (
            <li key={row.slug} className="row">
              <span className="row-name">
                {row.state !== 's3' ? <Link to={`/recipes/${row.slug}`}>{row.title}</Link> : row.title}
              </span>
              <span className={`badge badge-${row.state}`}>{STATE_LABEL[row.state]}</span>
              <span className="row-actions">
                {row.state !== 's3' && (
                  <button disabled={busy === row.slug} onClick={() => syncUp(row)}>
                    Sync up
                  </button>
                )}
                {row.state !== 'app' && (
                  <button disabled={busy === row.slug} onClick={() => syncDown(row)}>
                    Sync down
                  </button>
                )}
                <select
                  aria-label={`Delete ${row.title}`}
                  value=""
                  disabled={busy === row.slug}
                  onChange={(e) => e.target.value && remove(row, e.target.value as DeleteWhere)}
                >
                  <option value="">Delete…</option>
                  {deleteOptions(row.state).map((w) => (
                    <option key={w} value={w}>
                      From {WHERE_LABEL[w]}
                    </option>
                  ))}
                </select>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
