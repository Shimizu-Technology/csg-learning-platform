import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byteRange, sendMedia } from './media-range.mjs'

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

function respond(range) {
  const headers = {}
  const response = { statusCode: 0, body: null, setHeader: (name, value) => { headers[name] = value }, end: (body) => { response.body = body ?? null } }
  sendMedia({ headers: range ? { range } : {} }, response, Buffer.alloc(1000, 7))
  return { status: response.statusCode, headers, length: response.body?.length ?? 0 }
}
test('middleware answers 416 with the file size for past-EOF and reversed ranges', () => {
  for (const range of ['bytes=1000-', 'bytes=10-5']) {
    const result = respond(range)
    assert.equal(result.status, 416, range)
    assert.equal(result.headers['Content-Range'], 'bytes */1000', range)
    assert.equal(result.length, 0, range)
  }
})
test('middleware serves partial and whole-file responses', () => {
  assert.deepEqual(respond('bytes=0-1'), { status: 206, headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/1000' }, length: 2 })
  assert.deepEqual(respond(), { status: 200, headers: { 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4', 'Content-Length': '1000' }, length: 1000 })
})
