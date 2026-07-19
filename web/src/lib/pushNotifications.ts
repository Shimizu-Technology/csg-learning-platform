import { api } from './api'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

function subscriptionToJson(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint || subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
  }
}

function uint8ArrayToUrlBase64(bytes: Uint8Array) {
  let value = ''
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte)
  })

  return window.btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function subscriptionUsesPublicKey(subscription: PushSubscription, publicKey: string) {
  const currentKey = subscription.options.applicationServerKey
  if (!currentKey) return true

  return uint8ArrayToUrlBase64(new Uint8Array(currentKey)) === publicKey.replace(/=+$/g, '')
}

async function subscribeWithPublicKey(registration: ServiceWorkerRegistration, publicKey: string) {
  const existing = await registration.pushManager.getSubscription()
  if (existing && subscriptionUsesPublicKey(existing, publicKey)) return existing

  if (existing) {
    await api.deletePushSubscription(existing.endpoint)
    await existing.unsubscribe()
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
}

async function saveSubscription(subscription: PushSubscription) {
  const payload = subscriptionToJson(subscription)
  if (!payload.keys.p256dh || !payload.keys.auth) {
    throw new Error('Browser subscription keys were missing.')
  }

  const result = await api.createPushSubscription(payload)
  if (result.error) {
    throw new Error(result.error)
  }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function pushConfigurationHint({
  configured,
  missing = [],
  publicKey,
}: {
  configured: boolean
  missing?: string[]
  publicKey?: string | null
}) {
  const notes: string[] = []

  if (!configured) {
    if (missing.length > 0) notes.push(`API push is missing ${missing.join(', ')}.`)
    else notes.push('API push is not configured yet.')
  }

  if (!publicKey) {
    notes.push('Netlify also needs VITE_WEB_PUSH_PUBLIC_KEY.')
  }

  if (notes.length === 0) return ''

  notes.push('Redeploy after updating env vars.')
  return notes.join(' ')
}

export async function enablePushNotifications(publicKey: string) {
  if (!pushSupported()) {
    throw new Error('Push notifications are not supported in this browser.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications were not enabled.')
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await subscribeWithPublicKey(registration, publicKey)
  await saveSubscription(subscription)

  return subscription
}

export async function refreshExistingPushSubscription(publicKey: string) {
  if (!pushSupported() || Notification.permission !== 'granted') return false

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (!existing) return false

  const subscription = await subscribeWithPublicKey(registration, publicKey)

  // Re-save even when the browser subscription is unchanged. The API treats
  // this as a heartbeat and clears failed_at, which lets existing devices heal
  // after transient Web Push failures, DB restores, or deployments where the
  // browser still has a valid subscription but Rails stopped considering it
  // active.
  await saveSubscription(subscription)

  return true
}

export async function disablePushNotifications() {
  if (!pushSupported()) {
    const result = await api.deletePushSubscription(undefined, true)
    if (result.error) throw new Error(result.error)
    return
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  const result = await api.deletePushSubscription(subscription?.endpoint, true)
  if (result.error) throw new Error(result.error)
  await subscription?.unsubscribe()
}
