import { describe, expect, it } from 'vitest'
import { badNumber, changeUnit, formatAmount, parseAmount } from './amount'
import { blankRecipe, emptyIngredient, fromServer, insertAfter, move, problems, sameSection, toServer } from './editorState'
import type { EditorRecipe } from './toolApi'

describe('amounts (T3)', () => {
  it.each([
    ['320 g', { amount: '320', unit: 'g' }],
    ['½ tsp', { amount: '½', unit: 'tsp' }],
    ['1.5 KG', { amount: '1.5', unit: 'kg' }],
    ['2', { amount: '2', unit: '' }],
    ['1/2 tbsp', { amount: '1/2', unit: 'tbsp' }],
    ['', { amount: '', unit: '' }],
    ['128 g*', { amount: '128 g*', unit: 'written' }],
    ['1 bunch', { amount: '1 bunch', unit: 'written' }],
  ])('reads %j', (qty, expected) => {
    expect(parseAmount(qty)).toEqual(expected)
  })

  it('writes the qty back as recipe.json has it', () => {
    expect(formatAmount({ amount: '200', unit: 'g' })).toBe('200 g')
    expect(formatAmount({ amount: '1,5', unit: 'l' })).toBe('1.5 l')
    expect(formatAmount({ amount: '2', unit: '' })).toBe('2')
    expect(formatAmount({ amount: '', unit: 'g' })).toBe('')
    expect(formatAmount({ amount: '128 g*', unit: 'written' })).toBe('128 g*')
  })

  it('round-trips everything it can parse', () => {
    for (const q of ['320 g', '½ tsp', '2', '50 ml', '1 1/2 tbsp']) expect(formatAmount(parseAmount(q))).toBe(q)
  })

  it('flags an amount that is not a number', () => {
    expect(badNumber({ amount: 'lots', unit: 'g' })).toBe(true)
    expect(badNumber({ amount: '2.5', unit: 'g' })).toBe(false)
    expect(badNumber({ amount: 'lots', unit: 'written' })).toBe(false)
  })

  it('leaving "as written" keeps the leading number', () => {
    expect(changeUnit({ amount: '128 g*', unit: 'written' }, 'g')).toEqual({ amount: '128', unit: 'g' })
    expect(changeUnit({ amount: 'a handful', unit: 'written' }, '')).toEqual({ amount: '', unit: '' })
    expect(changeUnit({ amount: '2', unit: 'tsp' }, 'written')).toEqual({ amount: '2 tsp', unit: 'written' })
  })
})

const server: EditorRecipe = {
  slug: 'bowl',
  title: 'Bowl',
  subtitle: '',
  serves: 4,
  hero: 'keep',
  ingredients: [
    { qty: '320 g', name: 'Prawns', cupboard: false, allergens: 'Crustaceans' },
    { qty: '2 tbsp', name: 'Oil', cupboard: true, allergens: '' },
  ],
  steps: [
    { title: 'One', text: 'a', photo: 'keep', photo_from: 1 },
    { title: 'Two', text: 'b', photo: 'none', photo_from: null },
  ],
  updated_at: '2026-11-20T10:00:00',
}

describe('editor state', () => {
  it('round-trips a recipe from the server', () => {
    const { recipe, photos } = toServer(fromServer(server))
    expect(photos).toEqual({})
    expect(recipe).toEqual({ ...server, updated_at: undefined })
  })

  it('names new photos by their step position, after reordering', () => {
    const s = fromServer(server)
    const blob = new Blob(['x'])
    s.steps[1].photo = { kind: 'new', blob }
    s.steps = move(s.steps, s.steps[1].id, -1)
    s.hero = { kind: 'new', blob }
    const { recipe, photos } = toServer(s)
    expect(Object.keys(photos).sort()).toEqual(['hero.jpg', 'step-1.jpg'])
    expect(recipe.steps.map((st) => [st.title, st.photo, st.photo_from])).toEqual([
      ['Two', 'new', null],
      ['One', 'keep', 1],
    ])
  })

  it('drops blank ingredient rows and bad servings', () => {
    const s = blankRecipe()
    s.title = 'X'
    s.serves = ''
    expect(toServer(s).recipe.ingredients).toEqual([])
    expect(toServer(s).recipe.serves).toBeNull()
  })

  it('moves ingredients only within their section', () => {
    const rows = fromServer(server).ingredients
    const [prawns, oil] = rows
    const extra = { ...emptyIngredient(false), name: 'Rice' }
    const all = insertAfter(rows, null, extra) // goes to the end of the ingredients section, before Oil
    expect(all.map((r) => r.name)).toEqual(['Prawns', 'Rice', 'Oil'])
    expect(move(all, extra.id, 1, sameSection)).toBe(all) // can't move past the last ingredient
    expect(move(all, extra.id, -1, sameSection).map((r) => r.name)).toEqual(['Rice', 'Prawns', 'Oil'])
    expect(move(all, oil.id, -1, sameSection)).toBe(all)
    expect(insertAfter(all, prawns.id, { ...emptyIngredient(), name: 'Lime' }).map((r) => r.name)).toEqual(['Prawns', 'Lime', 'Rice', 'Oil'])
  })

  it('needs a name before saving', () => {
    expect(problems(blankRecipe())).toEqual(['Give the recipe a name.'])
    expect(problems({ ...blankRecipe(), title: '!!' })).toHaveLength(1)
    expect(problems({ ...blankRecipe(), title: 'Soup' })).toEqual([])
  })
})
