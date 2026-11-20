import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider, useConfirm } from './ConfirmDialog'

function Harness() {
  const confirm = useConfirm()
  const [result, setResult] = useState('none')
  return (
    <>
      <button onClick={async () => setResult(String(await confirm({ title: 'Delete Basil?', confirmLabel: 'Delete', danger: true })))}>
        ask
      </button>
      <span data-testid="result">{result}</span>
    </>
  )
}

const setup = () =>
  render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  )

describe('ConfirmDialog', () => {
  it('resolves true on confirm', async () => {
    setup()
    await userEvent.click(screen.getByText('ask'))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete Basil?')
    await userEvent.click(screen.getByText('Delete'))
    expect(screen.getByTestId('result')).toHaveTextContent('true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('resolves false on cancel, Escape, or Enter (cancel has focus)', async () => {
    setup()
    await userEvent.click(screen.getByText('ask'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByTestId('result')).toHaveTextContent('false')

    await userEvent.click(screen.getByText('ask'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('ask'))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('result')).toHaveTextContent('false')
  })
})
