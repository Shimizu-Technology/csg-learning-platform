import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkedLifecycle } from './ownership.mjs'

for (const action of ['claim', 'release']) {
  test(`${action} rejects an unsuccessful ownership command with its diagnostics`, () => {
    assert.throws(() => checkedLifecycle('owner', action, 'page', () => ({ status: 1, stdout: 'ownership refused', stderr: 'wrong session' })), error => error.message.includes(action) && error.message.includes('ownership refused') && error.message.includes('wrong session'))
  })
  test(`${action} rejects an unavailable command and a terminated command`, () => {
    assert.throws(() => checkedLifecycle('owner', action, 'page', () => ({ status: null, error: new Error('spawn ENOENT') })), /spawn ENOENT/)
    assert.throws(() => checkedLifecycle('owner', action, 'page', () => ({ status: null, signal: 'SIGTERM' })), /SIGTERM/)
  })
}
test('a successful ownership command preserves the exact owner and page identity', () => {
  checkedLifecycle('current-owner', 'claim', 'current-page', (command, args) => {
    assert.equal(command, 'dev-lifecycle')
    assert.deepEqual(args.slice(0, 5), ['claim', '--session', 'current-owner', 'browser-tab', 'current-page'])
    return { status: 0 }
  })
})
