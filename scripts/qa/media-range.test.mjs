import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteRange } from './media-range.mjs'

test('serves the whole file without a range', () => {
  assert.deepEqual(byteRange(undefined, 1000), { start: 0, end: 999, partial: false })
})
test('serves open, closed, clamped and suffix ranges', () => {
  assert.deepEqual(byteRange('bytes=0-1', 1000), { start: 0, end: 1, partial: true })
  assert.deepEqual(byteRange('bytes=500-', 1000), { start: 500, end: 999, partial: true })
  assert.deepEqual(byteRange('bytes=900-5000', 1000), { start: 900, end: 999, partial: true })
  assert.deepEqual(byteRange('bytes=-100', 1000), { start: 900, end: 999, partial: true })
})
test('rejects ranges past the end of the file or with reversed bounds', () => {
  assert.equal(byteRange('bytes=1000-', 1000), null)
  assert.equal(byteRange('bytes=1001-', 1000), null)
  assert.equal(byteRange('bytes=10-5', 1000), null)
  assert.equal(byteRange('bytes=-0', 1000), null)
})
