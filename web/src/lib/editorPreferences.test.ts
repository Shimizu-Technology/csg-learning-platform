// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updateEditorPreferences = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ api: { updateEditorPreferences } }))

import {
  applyServerEditorPreferences,
  EDITOR_PREFERENCES_CHANGE_EVENT,
  editorPreferencesKey,
  readEditorPreferences,
  writeEditorPreferences,
} from './editorPreferences'

const USER = 41
const stored = () => JSON.parse(window.localStorage.getItem(editorPreferencesKey(USER)) || 'null')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
type Account = { mode: 'rich' | 'markdown' | null; enter_sends: boolean | null }
type Body = { mode?: 'rich' | 'markdown'; enter_sends?: boolean; initialize?: boolean }

/** What the API does with one request: initialize sets only fields the account doesn't have yet. */
function apply(account: Account, { initialize, ...values }: Body) {
  for (const [field, value] of Object.entries(values) as [keyof Account, never][]) {
    if (!initialize || account[field] === null) account[field] = value
  }
  return { data: { editor_preferences: { ...account } }, error: null, status: 200 }
}

/** The server saves what it's sent and answers with the account's values. */
function serverSaves(account: Account) {
  updateEditorPreferences.mockImplementation(async (body: Body) => apply(account, body))
  return account
}

/** A server whose answers wait until the test releases them; each request applies when released. */
function heldServer(account: Account) {
  const held: { body: Body; release: () => void }[] = []
  updateEditorPreferences.mockImplementation((body: Body) => new Promise((resolve) => {
    held.push({ body, release: () => resolve(apply(account, body)) })
  }))
  return held
}

beforeEach(() => {
  window.localStorage.clear()
  updateEditorPreferences.mockReset()
})
afterEach(() => window.localStorage.clear())

describe('editor preferences on the account (U-6.8)', () => {
  it('uploads the choice this browser remembered before preferences were saved on the account, once', async () => {
    window.localStorage.setItem(editorPreferencesKey(USER), JSON.stringify({ mode: 'markdown', enterSends: false }))
    const account = serverSaves({ mode: null, enter_sends: null })

    applyServerEditorPreferences(USER, { mode: null, enter_sends: null })
    await settle()

    expect(updateEditorPreferences).toHaveBeenCalledWith({ mode: 'markdown', enter_sends: false, initialize: true })
    expect(account).toEqual({ mode: 'markdown', enter_sends: false })
    expect(stored()).toEqual({ mode: 'markdown', enterSends: false })
    expect(readEditorPreferences(USER)).toEqual({ mode: 'markdown', enterSends: false })

    // The next sign-in finds them on the account: nothing to send.
    updateEditorPreferences.mockClear()
    applyServerEditorPreferences(USER, account)
    await settle()
    expect(updateEditorPreferences).not.toHaveBeenCalled()
  })

  it('sends nothing for a person who never chose, and opens with the defaults', async () => {
    applyServerEditorPreferences(USER, { mode: null, enter_sends: null })
    await settle()
    expect(updateEditorPreferences).not.toHaveBeenCalled()
    expect(readEditorPreferences(USER)).toEqual({ mode: 'rich', enterSends: true })
  })

  it('takes a choice made on another device over this browser\'s older copy, and tells open composers', async () => {
    window.localStorage.setItem(editorPreferencesKey(USER), JSON.stringify({ mode: 'rich', enterSends: true }))
    const changes: unknown[] = []
    const listen = (event: Event) => changes.push((event as CustomEvent).detail)
    window.addEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, listen)

    applyServerEditorPreferences(USER, { mode: 'markdown', enter_sends: false })
    await settle()
    window.removeEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, listen)

    expect(updateEditorPreferences).not.toHaveBeenCalled()
    expect(readEditorPreferences(USER)).toEqual({ mode: 'markdown', enterSends: false })
    expect(changes).toEqual([{ userId: USER, preferences: { mode: 'markdown', enterSends: false } }])
  })

  it('saves a new choice to the account and keeps it pending until the server has it', async () => {
    const account = serverSaves({ mode: 'rich', enter_sends: true })
    writeEditorPreferences(USER, { mode: 'markdown' })
    expect(stored()).toEqual({ mode: 'markdown', pending: ['mode'] })
    await settle()
    expect(updateEditorPreferences).toHaveBeenCalledWith({ mode: 'markdown' })
    expect(account.mode).toBe('markdown')
    expect(stored()).toEqual({ mode: 'markdown' })
  })

  it('sends a choice whose save failed again at the next sign-in, instead of losing it to the older account value', async () => {
    updateEditorPreferences.mockResolvedValue({ data: null, error: 'Offline', status: 0 })
    writeEditorPreferences(USER, { enterSends: false })
    await settle()
    expect(stored()).toEqual({ enterSends: false, pending: ['enterSends'] })

    const account = serverSaves({ mode: 'markdown', enter_sends: true })
    applyServerEditorPreferences(USER, { mode: 'markdown', enter_sends: true })
    await settle()
    expect(updateEditorPreferences).toHaveBeenLastCalledWith({ enter_sends: false })
    expect(account).toEqual({ mode: 'markdown', enter_sends: false })
    // The account's mode arrives; this browser's Enter choice wins.
    expect(stored()).toEqual({ mode: 'markdown', enterSends: false })
  })

  it('keeps a choice when the request itself throws', async () => {
    updateEditorPreferences.mockRejectedValue(new Error('network'))
    expect(writeEditorPreferences(USER, { mode: 'markdown' })).toEqual({ mode: 'markdown', enterSends: true })
    await settle()
    expect(readEditorPreferences(USER).mode).toBe('markdown')
    expect(stored().pending).toEqual(['mode'])
  })

  it('takes the account\'s value when another device chose before this browser\'s one-time upload arrived', async () => {
    window.localStorage.setItem(editorPreferencesKey(USER), JSON.stringify({ mode: 'markdown', enterSends: false }))
    const account: Account = { mode: null, enter_sends: null }
    const held = heldServer(account)
    const changes: unknown[] = []
    const listen = (event: Event) => changes.push((event as CustomEvent).detail.preferences)
    window.addEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, listen)

    // This device loaded with nothing on the account and prepared its upload...
    applyServerEditorPreferences(USER, { mode: null, enter_sends: null })
    await settle()
    expect(held.map(({ body }) => body)).toEqual([{ mode: 'markdown', enter_sends: false, initialize: true }])
    // ...then another device saved Rich before that upload reached the server.
    account.mode = 'rich'
    held[0].release()
    await settle()
    window.removeEventListener(EDITOR_PREFERENCES_CHANGE_EVENT, listen)

    expect(account).toEqual({ mode: 'rich', enter_sends: false })
    expect(readEditorPreferences(USER)).toEqual({ mode: 'rich', enterSends: false })
    expect(stored()).toEqual({ mode: 'rich', enterSends: false })
    expect(changes).toEqual([{ mode: 'rich', enterSends: false }])
  })

  it('saves one choice at a time, so a slow answer never leaves the account on an older choice', async () => {
    const account: Account = { mode: 'rich', enter_sends: true }
    const held = heldServer(account)

    writeEditorPreferences(USER, { mode: 'markdown' })
    await settle()
    writeEditorPreferences(USER, { mode: 'rich' })
    await settle()
    // The second choice waits for the first save to settle instead of racing it.
    expect(held.map(({ body }) => body)).toEqual([{ mode: 'markdown' }])

    held[0].release()
    await settle()
    // Markdown is confirmed, but this browser now holds Rich: still pending, and sent next.
    expect(stored().pending).toEqual(['mode'])
    expect(held.map(({ body }) => body)).toEqual([{ mode: 'markdown' }, { mode: 'rich' }])

    held[1].release()
    await settle()
    expect(account.mode).toBe('rich')
    expect(stored()).toEqual({ mode: 'rich' })
  })

  it('sends only the latest of several quick choices', async () => {
    const account = serverSaves({ mode: 'rich', enter_sends: true })
    writeEditorPreferences(USER, { mode: 'markdown' })
    writeEditorPreferences(USER, { mode: 'rich' })
    writeEditorPreferences(USER, { mode: 'markdown' })
    await settle()
    expect(updateEditorPreferences.mock.calls.map(([body]) => body)).toEqual([{ mode: 'markdown' }])
    expect(account.mode).toBe('markdown')
    expect(stored()).toEqual({ mode: 'markdown' })
  })

  it('never sends a signed-out choice to an account', async () => {
    writeEditorPreferences(undefined, { mode: 'markdown' })
    await settle()
    expect(updateEditorPreferences).not.toHaveBeenCalled()
    expect(readEditorPreferences(undefined).mode).toBe('markdown')
  })

  it('reads an older stored copy and ignores values it does not know', () => {
    window.localStorage.setItem(editorPreferencesKey(USER), JSON.stringify({ mode: 'wysiwyg', enterSends: 'no', pending: ['mode', 'other'] }))
    expect(readEditorPreferences(USER)).toEqual({ mode: 'rich', enterSends: true })
  })
})
