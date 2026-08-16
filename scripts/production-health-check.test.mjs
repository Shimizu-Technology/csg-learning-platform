import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  fetchJsonWithRetry,
  runProductionHealthCheck,
  validateHealthPayload,
  validateReadinessPayload,
} from './production-health-check.mjs'

test('validates the expected production health contract', () => {
  assert.equal(validateHealthPayload({ status: 'ok' }).status, 'ok')
  assert.equal(
    validateReadinessPayload({ status: 'ok', checks: { database: 'ok', queue: 'not_required' } }).checks.queue,
    'not_required',
  )
})

test('rejects a queue mode change while workerless production is expected', () => {
  assert.throws(
    () => validateReadinessPayload({ status: 'ok', checks: { database: 'ok', queue: 'ok' } }),
    /expected "not_required"/,
  )
})

test('retries transient failures and validates both live endpoints', async (t) => {
  let healthRequests = 0
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json')

    if (request.url === '/health') {
      healthRequests += 1
      if (healthRequests === 1) {
        response.statusCode = 503
        response.end(JSON.stringify({ status: 'unavailable' }))
        return
      }

      response.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (request.url === '/api/v1/ready') {
      response.end(JSON.stringify({ status: 'ok', checks: { database: 'ok', queue: 'not_required' } }))
      return
    }

    response.statusCode = 404
    response.end(JSON.stringify({ status: 'not_found' }))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const { port } = server.address()
  const messages = []
  await runProductionHealthCheck({
    healthUrl: `http://127.0.0.1:${port}/health`,
    readinessUrl: `http://127.0.0.1:${port}/api/v1/ready`,
    attempts: 2,
    timeoutMs: 1_000,
    log: (message) => messages.push(message),
  })

  assert.equal(healthRequests, 2)
  assert.equal(messages.length, 2)
  assert.match(messages[1], /queue=not_required/)
})

test('reports invalid JSON without leaking a response body', async () => {
  const fetchImpl = async () => new Response('<html>not json</html>', { status: 200 })

  await assert.rejects(
    fetchJsonWithRetry('https://example.test/ready', 'Readiness endpoint', {
      attempts: 1,
      fetchImpl,
    }),
    /returned invalid JSON/,
  )
})
