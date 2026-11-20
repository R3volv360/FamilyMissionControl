/**
 * M8: the week's ingredients, each listed once with its total for the week (e.g. 100 g + 200 g + 400 g of
 * an ingredient shows as 700 g), split into To buy / Already in the pantry / In the freezer. The meals
 * we're shopping for are listed in their own section, not against each ingredient.
 * M11: freezer items whose recipe amounts aren't in grams are flagged, and listed at the bottom (and on
 * the printout).
 * Below "to buy", every other pantry item that isn't fully stocked: "Only one left", then "Empty".
 * M10: Print shows only what to buy (the meals' list, then the two pantry sections), with a box to tick
 * beside each item.
 */
import { longDate } from './dates'
import type { ListLine, PlannedRecipe, ShoppingList } from './plannerApi'

const LEVEL_NOTE = { one: 'Pantry: only one left', empty: 'Pantry: empty', full: '' } as const

/** The three lists to shop from, in order: the meals' ingredients, then pantry items running low. */
const buySections = (list: ShoppingList) => [
  { title: 'To buy for meals', lines: list.buy },
  { title: 'Pantry: only one left', lines: list.pantry_one },
  { title: 'Pantry: empty', lines: list.pantry_empty },
]

const mealSummary = (meals: PlannedRecipe[]) => meals.map((m) => `${m.weekday} ${m.title}`).join(' · ')

function Line({ line, children }: { line: ListLine; children?: React.ReactNode }) {
  return (
    <li>
      <span className="line-name">{line.name}</span>
      {children}
      {line.total && <span className="line-total">{line.total}</span>}
    </li>
  )
}

export function ShoppingListPanel({ list }: { list: ShoppingList | null }) {
  if (!list) return <p className="muted no-print">Loading the list…</p>
  const restockCount = list.pantry_one.length + list.pantry_empty.length
  const toBuyCount = list.buy.length + restockCount
  if (list.meals.length === 0 && restockCount === 0)
    return (
      <section className="shopping card no-print">
        <h2>Shopping list</h2>
        <p className="muted">Plan some meals and their ingredients appear here.</p>
      </section>
    )

  return (
    <>
      <section className="shopping card no-print" aria-label="Shopping list">
        <div className="page-head">
          <h2>Shopping list</h2>
          <button className="btn-primary" onClick={() => window.print()} disabled={toBuyCount === 0}>
            Print “to buy” list
          </button>
        </div>
        <p className="muted small">Totals for the whole week. Uses what's in the pantry and freezer right now.</p>

        <h3>To buy for meals ({list.buy.length})</h3>
        {list.buy.length === 0 ? (
          <p className="muted">{list.meals.length === 0 ? 'No meals planned this week.' : 'Nothing to buy.'}</p>
        ) : (
          <ul className="list-lines">
            {list.buy.map((line) => (
              <Line key={line.name} line={line}>
                {line.pantry_level && line.pantry_level !== 'full' && <span className="badge">{LEVEL_NOTE[line.pantry_level]}</span>}
              </Line>
            ))}
          </ul>
        )}

        {list.pantry_one.length > 0 && (
          <>
            <h3>Pantry: only one left ({list.pantry_one.length})</h3>
            <ul className="list-lines">
              {list.pantry_one.map((line) => (
                <Line key={line.name} line={line} />
              ))}
            </ul>
          </>
        )}

        {list.pantry_empty.length > 0 && (
          <>
            <h3>Pantry: empty ({list.pantry_empty.length})</h3>
            <ul className="list-lines">
              {list.pantry_empty.map((line) => (
                <Line key={line.name} line={line} />
              ))}
            </ul>
          </>
        )}

        {list.pantry.length > 0 && (
          <>
            <h3>Already in the pantry ({list.pantry.length})</h3>
            <ul className="list-lines dim">
              {list.pantry.map((line) => (
                <Line key={line.name} line={line} />
              ))}
            </ul>
          </>
        )}

        {list.freezer.length > 0 && (
          <>
            <h3>In the freezer ({list.freezer.length})</h3>
            <ul className="list-lines">
              {list.freezer.map((line) => (
                <Line key={line.name} line={line}>
                  <span className="badge">Freezer: {line.freezer_label}</span>
                  {line.unit_mismatch && <span className="badge badge-failed">Units differ: check</span>}
                  {line.short_label && <span className="badge badge-warn">May be {line.short_label} short</span>}
                </Line>
              ))}
            </ul>
          </>
        )}

        {list.unit_mismatches.length > 0 && (
          <p className="mismatch-note">
            <strong>Check the freezer:</strong> {list.unit_mismatches.join(', ')}. The recipe amounts aren't in grams, so
            they can't be compared with what's in the freezer.
          </p>
        )}

        {list.meals.length > 0 && (
          <>
            <h3>Meals this week ({list.meals.length})</h3>
            <ul className="meal-summary">
              {list.meals.map((m, i) => (
                <li key={i}>
                  <span className="muted">{m.weekday}</span> {m.title}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <PrintList list={list} />
    </>
  )
}

function PrintList({ list }: { list: ShoppingList }) {
  return (
    <section className="print-only print-list">
      <h1>Shopping list</h1>
      <p>Week of {longDate(list.start)}</p>
      {buySections(list)
        .filter((section) => section.lines.length > 0)
        .map((section) => (
          <div key={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.lines.map((line) => (
                <li key={line.name}>
                  <span className="tick" aria-hidden="true" />
                  <span className="print-name">{line.name}</span>
                  {line.total && <span className="print-total">{line.total}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {list.unit_mismatches.length > 0 && (
        <p className="print-note">
          In the freezer, but the recipe amounts aren't in grams, so check before shopping:{' '}
          {list.unit_mismatches.join(', ')}.
        </p>
      )}
      {list.meals.length > 0 && (
        <p className="print-meals">
          <strong>Meals:</strong> {mealSummary(list.meals)}
        </p>
      )}
    </section>
  )
}
