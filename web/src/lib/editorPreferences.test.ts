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
/** The server saves what it's sent and answers with the account's values. */
function serverSaves(account: { mode: 'rich' | 'markdown' | null; enter_sends: boolean | null }) {
  updateEditorPreferences.mockImplementation(async (body: { mode?: 'rich' | 'markdown'; enter_sends?: boolean }) => {
    Object.assign(account, body)
    return { data: { editor_preferences: { ...account } }, error: null, status: 200 }
  })
  return account
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

    expect(updateEditorPreferences).toHaveBeenCalledWith({ mode: 'markdown', enter_sends: false })
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
