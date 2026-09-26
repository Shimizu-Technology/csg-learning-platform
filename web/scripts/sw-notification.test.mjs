import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const listeners = new Map()
const context = {
  URL,
  self: { location: { origin: 'https://learn.codeschoolofguam.com' }, addEventListener: (name, listener) => listeners.set(name, listener) },
}
const targetPath = runInNewContext(`${worker}\nnotificationTargetPath`, context)

assert.equal(targetPath({ path: '/messages/12', message_id: 45 }), '/messages/12?message_id=45')
assert.equal(targetPath({ path: '/messages/dm/12', message_id: 45 }), '/messages/dm/12?message_id=45')
assert.equal(targetPath({ path: '/updates', message_id: 45 }), '/updates')
assert.equal(targetPath({ path: '/messages/12', message_id: 'bad' }), '/messages/12')
assert.equal(targetPath({ path: 'https://example.com', message_id: 45 }), '/')

let shown
context.self.registration = { showNotification: async (_title, options) => { shown = options } }
let pending
listeners.get('push')({
  data: { json: () => ({ title: 'New message', path: '/messages/dm/12', message_id: 45 }) },
  waitUntil: (promise) => { pending = promise },
})
await pending
assert.equal(shown.data.path, '/messages/dm/12?message_id=45')

let navigatedTo
let focused = false
let opened = false
context.self.clients = {
  matchAll: async () => [{
    url: 'https://learn.codeschoolofguam.com/messages/dm/12',
    navigate: async (url) => { navigatedTo = url; return { focus: async () => { focused = true } } },
  }],
  openWindow: async () => { opened = true },
}
listeners.get('notificationclick')({
  notification: { data: shown.data, close: () => {} },
  waitUntil: (promise) => { pending = promise },
})
await pending
assert.equal(navigatedTo, 'https://learn.codeschoolofguam.com/messages/dm/12?message_id=45')
assert.equal(focused, true)
assert.equal(opened, false)

console.log('Service worker notification anchor checks passed.')
