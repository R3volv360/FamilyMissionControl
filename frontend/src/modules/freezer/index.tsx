import type { AppModule } from '../types'
import { FreezerSummary } from './FreezerSummary'
import { FreezerPage } from './FreezerPage'

export const freezerModule: AppModule = { path: '/freezer', label: 'Freezer', element: <FreezerPage />, summary: <FreezerSummary /> }
