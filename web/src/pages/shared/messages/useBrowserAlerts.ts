import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../../lib/pushNotifications';

/** Browser push alerts for messages on this device: whether they're on, and turning them on or off. */
export function useBrowserAlerts() {
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      api.getPushConfig(),
      pushSupported()
        ? navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).catch(() => null)
        : Promise.resolve(null),
    ]).then(([config, subscription]) => {
      if (!active) return
      setPushEnabled(browserPushEnabled(config.data, subscription))
    }).catch(() => {
      if (active) setPushEnabled(false)
    })

    return () => {
      active = false
    }
  }, [])

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Browser alerts are off on your account. Message emails are unchanged.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
      }
      return
    }

    if (!pushSupported()) {
      setPushMessage('Browser alerts are not supported on this device. You can still manage message emails from Profile.')
      return
    }

    const config = await api.getPushConfig()
    if (config.error) {
      setPushMessage(`Browser alerts could not be checked: ${config.error}`)
      return
    }

    const configured = Boolean(config.data?.configured)
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!configured || !publicKey) {
      const hint = pushConfigurationHint({
        configured,
        missing: config.data?.missing || [],
        publicKey,
      })
      setPushMessage(hint)
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Browser alerts are on for this device. Message emails are managed separately in Profile.')
    } catch (toggleError) {
      const detail = toggleError instanceof Error ? toggleError.message : 'Browser push could not be enabled.'
      setPushMessage(detail)
    }
  }

  return { pushEnabled, pushMessage, handleTogglePush }
}

export type BrowserAlerts = ReturnType<typeof useBrowserAlerts>
