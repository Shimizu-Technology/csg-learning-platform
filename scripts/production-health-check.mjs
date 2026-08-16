const DEFAULT_HEALTH_URL = 'https://csg-learn-api.onrender.com/health'
const DEFAULT_READINESS_URL = 'https://csg-learn-api.onrender.com/api/v1/ready'
const DEFAULT_EXPECTED_QUEUE_STATUS = 'not_required'

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned a non-object JSON payload`)
  }

  return value
}

export function validateHealthPayload(payload) {
  const health = requireObject(payload, 'Health endpoint')
  if (health.status !== 'ok') {
    throw new Error(`Health endpoint reported status=${JSON.stringify(health.status)}`)
  }

  return health
}

export function validateReadinessPayload(payload, expectedQueueStatus = DEFAULT_EXPECTED_QUEUE_STATUS) {
  const readiness = requireObject(payload, 'Readiness endpoint')
  const checks = requireObject(readiness.checks, 'Readiness checks')

  if (readiness.status !== 'ok') {
    throw new Error(`Readiness endpoint reported status=${JSON.stringify(readiness.status)}`)
  }
  if (checks.database !== 'ok') {
    throw new Error(`Readiness database check reported ${JSON.stringify(checks.database)}`)
  }
  if (checks.queue !== expectedQueueStatus) {
    throw new Error(
      `Readiness queue check reported ${JSON.stringify(checks.queue)}; expected ${JSON.stringify(expectedQueueStatus)}`,
    )
  }

  return readiness
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function fetchJsonWithRetry(
  url,
  label,
  { attempts = 3, timeoutMs = 15_000, fetchImpl = fetch } = {},
) {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}`)
      }

      try {
        return await response.json()
      } catch (error) {
        throw new Error(`${label} returned invalid JSON: ${error.message}`)
      }
    } catch (error) {
      lastError = error
      if (attempt < attempts) await delay(attempt * 1_000)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(`${label} failed after ${attempts} attempt(s): ${lastError?.message || 'unknown error'}`)
}

export async function runProductionHealthCheck({
  healthUrl = DEFAULT_HEALTH_URL,
  readinessUrl = DEFAULT_READINESS_URL,
  expectedQueueStatus = DEFAULT_EXPECTED_QUEUE_STATUS,
  attempts = 3,
  timeoutMs = 15_000,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const health = await fetchJsonWithRetry(healthUrl, 'Health endpoint', { attempts, timeoutMs, fetchImpl })
  validateHealthPayload(health)
  log(`[production-health] health=ok url=${healthUrl}`)

  const readiness = await fetchJsonWithRetry(readinessUrl, 'Readiness endpoint', {
    attempts,
    timeoutMs,
    fetchImpl,
  })
  validateReadinessPayload(readiness, expectedQueueStatus)
  log(
    `[production-health] readiness=ok database=${readiness.checks.database} ` +
      `queue=${readiness.checks.queue} url=${readinessUrl}`,
  )
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }

  return parsed
}

async function main() {
  await runProductionHealthCheck({
    healthUrl: process.env.HEALTH_URL || DEFAULT_HEALTH_URL,
    readinessUrl: process.env.READINESS_URL || DEFAULT_READINESS_URL,
    expectedQueueStatus: process.env.EXPECTED_QUEUE_STATUS || DEFAULT_EXPECTED_QUEUE_STATUS,
    attempts: positiveInteger(process.env.HEALTH_CHECK_ATTEMPTS, 3, 'HEALTH_CHECK_ATTEMPTS'),
    timeoutMs: positiveInteger(process.env.HEALTH_CHECK_TIMEOUT_MS, 15_000, 'HEALTH_CHECK_TIMEOUT_MS'),
  })
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((error) => {
    console.error(`[production-health] failed: ${error.message}`)
    process.exitCode = 1
  })
}
