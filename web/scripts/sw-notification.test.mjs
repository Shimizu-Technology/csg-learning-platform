import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const listeners = new Map()
const context = {
  URL,
  self: { addEventListener: (name, listener) => listeners.set(name, listener) },
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

console.log('Service worker notification anchor checks passed.')
