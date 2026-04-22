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
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })

  const payload = subscriptionToJson(subscription)
  if (!payload.keys.p256dh || !payload.keys.auth) {
    throw new Error('Browser subscription keys were missing.')
  }

  const result = await api.createPushSubscription(payload)
  if (result.error) {
    throw new Error(result.error)
  }

  return subscription
}

export async function disablePushNotifications() {
  if (!pushSupported()) return

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  await api.deletePushSubscription(subscription.endpoint)
  await subscription.unsubscribe()
}
