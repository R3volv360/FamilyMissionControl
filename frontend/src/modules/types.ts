import type { ReactNode } from 'react'

/** A frontend module: one nav entry and its route. Sub-routes go under `${path}/*`. */
export interface AppModule {
  path: string
  label: string
  element: ReactNode
  /** Optional card body for the home page: a glance at the module's state. */
  summary?: ReactNode
}
