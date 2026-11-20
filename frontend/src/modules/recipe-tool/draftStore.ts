/**
 * Unsaved recipe drafts (spec T9), kept on this device in IndexedDB so new photos (Blobs) survive too. A phone
 * may reload a background tab at any time; the editor puts the draft back when it opens again.
 *
 * Every call fails soft: in a private window or with storage blocked, drafts just aren't kept.
 */
import type { EditorState } from './editorState'

const DB = 'missionControl.recipeTool'
const STORE = 'drafts'

export interface Draft {
  state: EditorState
  savedAt: number
  /** The recipe's updated_at when editing began, to spot a recipe changed since (e.g. re-uploaded). */
  base: string | null
}

export const draftKey = (slug: string | null) => (slug ? `edit:${slug}` : 'new')

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export const drafts = {
  async get(key: string): Promise<Draft | null> {
    try {
      return ((await run('readonly', (s) => s.get(key))) as Draft | undefined) ?? null
    } catch {
      return null
    }
  },
  async put(key: string, draft: Draft): Promise<void> {
    try {
      await run('readwrite', (s) => s.put(draft, key))
    } catch {
      /* not kept; the beforeunload prompt still guards against leaving */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await run('readwrite', (s) => s.delete(key))
    } catch {
      /* nothing to remove */
    }
  },
}
