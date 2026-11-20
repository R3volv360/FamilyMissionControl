import type { AppModule } from '../types'
import { PantrySummary } from './PantrySummary'
import { PantryPage } from './PantryPage'

export const pantryModule: AppModule = { path: '/pantry', label: 'Pantry', element: <PantryPage />, summary: <PantrySummary /> }
