import type { AppModule } from '../types'
import { PlannerSummary } from './PlannerSummary'
import { PlannerPage } from './PlannerPage'

export const plannerModule: AppModule = { path: '/planner', label: 'Meal Planner', element: <PlannerPage />, summary: <PlannerSummary /> }
