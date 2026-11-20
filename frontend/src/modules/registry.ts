/** Adding a module = create src/modules/<name>/index.tsx exporting an AppModule, then list it here. */
import { freezerModule } from './freezer'
import { pantryModule } from './pantry'
import { plannerModule } from './planner'
import { recipesModule } from './recipes'
import type { AppModule } from './types'

export const MODULES: AppModule[] = [plannerModule, recipesModule, pantryModule, freezerModule]
