// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LiveUrlToggle, SubmissionTypeSelect } from './SubmissionTypeField'
import { submissionTypeHint } from './submissionTypes'

let container: HTMLDivElement
let root: Root
let saved: (string | null)[] = []

function Field({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial)
  const change = (next: string | null) => { saved.push(next); setValue(next) }
  return <>
    <SubmissionTypeSelect id="submission" value={value} onChange={change} className="app-control" />
    <LiveUrlToggle value={value} onChange={change} />
    <p data-hint="">{submissionTypeHint(value)}</p>
  </>
}

beforeEach(() => {
  saved = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const select = () => container.querySelector<HTMLSelectElement>('#submission')!
const toggle = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')
const choose = (value: string) => act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })) })

describe('submission picker', () => {
  it('offers four choices and saves Project link as a repository submission, with an optional live URL', async () => {
    await act(async () => root.render(<Field initial="manual_complete" />))
    expect([...select().options].map((option) => option.textContent)).toEqual(['No submission', 'In-app answer or code', 'GitHub file sync', 'Project link'])
    expect(toggle()).toBeNull()

    await choose('repo_url_submission')
    expect(saved.at(-1)).toBe('repo_url_submission')
    expect(toggle()!.checked).toBe(false)
    expect(toggle()!.closest('label')!.textContent).toBe('Also require a live deployed URL')

    await act(async () => toggle()!.click())
    expect(saved.at(-1)).toBe('repo_and_live_url_submission')
    expect(select().value).toBe('repo_url_submission')
    expect(container.querySelector('[data-hint]')!.textContent).toContain('deployed live link')

    await act(async () => toggle()!.click())
    expect(saved.at(-1)).toBe('repo_url_submission')
  })

  it('loads a saved repository-and-live block as Project link with the checkbox on', async () => {
    await act(async () => root.render(<Field initial="repo_and_live_url_submission" />))
    expect(select().value).toBe('repo_url_submission')
    expect(toggle()!.checked).toBe(true)
    // Choosing Project link again keeps the live URL requirement.
    await choose('repo_url_submission')
    expect(saved.at(-1)).toBe('repo_and_live_url_submission')
  })

  it('keeps Lesson default for a block without its own type', async () => {
    await act(async () => root.render(<Field initial={null} />))
    expect(select().options[0].textContent).toBe('Lesson default')
    expect(select().value).toBe('')
  })
})
