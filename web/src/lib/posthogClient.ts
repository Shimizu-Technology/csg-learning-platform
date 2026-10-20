import type { PostHog } from 'posthog-js'

/**
 * PostHog is loaded on demand so the signed-out landing and sign-in pages do
 * not download or parse the analytics bundle before they render. With no key
 * configured the bundle is never requested. With a key, the first analytics
 * call schedules a load when the browser is idle; calls made before then are
 * queued (bounded) and replayed once the client is ready.
 */
const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

export const isPostHogEnabled = Boolean(POSTHOG_KEY && POSTHOG_KEY !== 'YOUR_POSTHOG_KEY')

type PostHogTask = (client: PostHog) => void

export const MAX_QUEUED_ANALYTICS_CALLS = 50
const IDLE_TIMEOUT_MS = 4000

let client: PostHog | null = null
let loading: Promise<PostHog | null> | null = null
let scheduled = false
const queue: PostHogTask[] = []

/**
 * Who analytics should attribute events to. PostHog persists the last
 * identified user in the browser, so queued events must not flush until the
 * current identity is applied: identify the signed-in user, or reset to an
 * anonymous id for a signed-out visitor. If the app never reports an identity
 * (for example Clerk fails to load), the queue flushes after a short wait.
 */
export type AnalyticsIdentity =
  | { kind: 'anonymous' }
  | { kind: 'user'; id: string; properties: Record<string, string | number> }

export const IDENTITY_WAIT_MS = 10_000

let identity: AnalyticsIdentity | null = null
let appliedIdentityKey: string | null = null
let identityWaiters: Array<() => void> = []

function identityKey(next: AnalyticsIdentity) {
  return next.kind === 'user' ? `user:${next.id}:${JSON.stringify(next.properties)}` : 'anonymous'
}

function applyIdentity(ph: PostHog, next: AnalyticsIdentity) {
  const key = identityKey(next)
  if (key === appliedIdentityKey) return
  appliedIdentityKey = key
  try {
    if (next.kind === 'user') ph.identify(next.id, next.properties)
    else ph.reset()
  } catch {
    // Analytics must never break the app.
  }
}

/** Record the current identity. Never triggers a load by itself. */
export function setPostHogIdentity(next: AnalyticsIdentity) {
  if (!isPostHogEnabled) return
  identity = next
  identityWaiters.splice(0).forEach((resolve) => resolve())
  if (client) applyIdentity(client, next)
}

function waitForIdentity(): Promise<void> {
  if (identity) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, IDENTITY_WAIT_MS)
    identityWaiters.push(() => {
      globalThis.clearTimeout(timer)
      resolve()
    })
  })
}

type Importer = () => Promise<{ default: PostHog }>
let importPostHog: Importer = () => import('posthog-js')

function flush(ready: PostHog) {
  while (queue.length > 0) {
    const task = queue.shift()!
    try {
      task(ready)
    } catch {
      // Analytics must never break the app.
    }
  }
}

export function loadPostHog(): Promise<PostHog | null> {
  if (!isPostHogEnabled || typeof window === 'undefined') return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  if (!loading) {
    loading = importPostHog()
      .then(async ({ default: posthog }) => {
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          capture_pageview: false,
          capture_pageleave: false,
          autocapture: false,
          disable_session_recording: true,
          loaded: (ph) => {
            if (import.meta.env.DEV) ph.opt_out_capturing()
          },
        })
        await waitForIdentity()
        if (identity) applyIdentity(posthog, identity)
        client = posthog
        flush(posthog)
        return posthog
      })
      .catch(() => {
        // Blocked by an extension or offline: drop queued calls and allow a later retry.
        queue.length = 0
        loading = null
        scheduled = false
        return null
      })
  }
  return loading
}

function scheduleLoad() {
  if (scheduled) return
  scheduled = true
  const start = () => { void loadPostHog() }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS })
  } else {
    globalThis.setTimeout(start, 1)
  }
}

export function isPostHogLoaded() {
  return client !== null
}

/** Run `task` with the PostHog client once it is loaded. No-op when analytics is disabled. */
export function withPostHog(task: PostHogTask): boolean {
  if (!isPostHogEnabled || typeof window === 'undefined') return false
  if (client) {
    try {
      task(client)
    } catch {
      // Analytics must never break the app.
    }
    return true
  }
  if (queue.length >= MAX_QUEUED_ANALYTICS_CALLS) queue.shift()
  queue.push(task)
  scheduleLoad()
  return true
}

/** Test hooks. */
export const __testing = {
  reset(importer?: Importer) {
    client = null
    loading = null
    scheduled = false
    queue.length = 0
    identity = null
    appliedIdentityKey = null
    identityWaiters = []
    importPostHog = importer || (() => import('posthog-js'))
  },
  queued: () => queue.length,
}
