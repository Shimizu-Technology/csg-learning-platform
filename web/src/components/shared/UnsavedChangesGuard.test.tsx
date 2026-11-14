// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom'
import { expect, it } from 'vitest'
import { UnsavedChangesGuard, useDraftDirty } from './UnsavedChangesGuard'

it('blocks links and history, keeps editing, confirms leave, and clears after saving', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  function Form() {
    const [value, setValue] = useState('')
    const [revision, setRevision] = useState(0)
    const dirty = useDraftDirty(value, revision)
    return <><UnsavedChangesGuard dirty={dirty} /><button onClick={() => setValue('draft')}>Edit</button><button onClick={() => setRevision(revision + 1)}>Save</button><Link to="/away">Back</Link></>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const router = createMemoryRouter([{ path: '/', element: <Form /> }, { path: '/away', element: <p>Away</p> }])
  const click = async (label: string) => { await act(async () => { Array.from(document.querySelectorAll('button,a')).find((node) => node.textContent === label)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) }) }
  try {
    await act(async () => root.render(<RouterProvider router={router} />))
    await click('Edit')
    await act(async () => router.navigate('/?filter=unread', { replace: true }))
    expect(router.state.location.search).toBe('?filter=unread')
    expect(document.body.textContent).not.toContain('Leave without saving?')
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
    await click('Back')
    expect(router.state.location.pathname).toBe('/')
    expect(document.body.textContent).toContain('Leave without saving?')
    await click('Keep editing'); expect(router.state.location.pathname).toBe('/')
    await click('Back'); await click('Discard changes and leave')
    expect(router.state.location.pathname).toBe('/away')
    await act(async () => router.navigate(-1))
    await click('Edit'); await click('Save')
    const savedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload); expect(savedUnload.defaultPrevented).toBe(false)
    await click('Back')
    expect(router.state.location.pathname).toBe('/away')
    await act(async () => router.navigate(-1)); await click('Edit')
    await act(async () => router.navigate(1))
    expect(router.state.location.pathname).toBe('/')
    await click('Discard changes and leave'); expect(router.state.location.pathname).toBe('/away')
  } finally { await act(async () => root.unmount()); host.remove(); router.dispose() }
})

it('uses the submitted baseline when newer edits exist at save completion', async () => {
  function Form() {
    const [value, setValue] = useState('original')
    const [revision, setRevision] = useState(0)
    const dirty = useDraftDirty(value, revision, true, JSON.stringify('submitted'))
    return <><output>{String(dirty)}</output><button onClick={() => setValue('newer')}>Edit</button><button onClick={() => setRevision(1)}>Complete save</button><button onClick={() => setValue('submitted')}>Revert to saved</button></>
  }
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<Form />))
    await act(async () => host.querySelectorAll('button')[0].click())
    await act(async () => host.querySelectorAll('button')[1].click())
    expect(host.querySelector('output')?.textContent).toBe('true')
    await act(async () => host.querySelectorAll('button')[2].click())
    expect(host.querySelector('output')?.textContent).toBe('false')
  } finally { await act(async () => root.unmount()) }
})
