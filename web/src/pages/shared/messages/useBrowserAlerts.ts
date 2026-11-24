import { useEffect, useState } from 'react';
import { useAuthContext } from '../../../contexts/AuthContext';
import { api } from '../../../lib/api';
import type { PushConfigResponse } from '../../../types/api';
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../../lib/pushNotifications';

/**
 * Browser push alerts on this device: whether they're on, and turning them on
 * or off. A page that already loaded the push config (Profile) passes it as
 * `config` (null while it loads) instead of this hook fetching it again.
 */
export function useBrowserAlerts(options: { config?: PushConfigResponse | null } = {}) {
  const { user } = useAuthContext()
  const admin = Boolean(user?.is_admin)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const provided = 'config' in options
  const providedConfig = options.config

  useEffect(() => {
    if (provided && !providedConfig) return
    let active = true
    Promise.all([
      provided ? Promise.resolve({ data: providedConfig }) : api.getPushConfig(),
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
  }, [provided, providedConfig])

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Browser alerts are off. Message emails are unchanged.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
      }
      return
    }

    if (!pushSupported()) {
      setPushMessage('This browser can’t show alerts. You’ll still get email alerts.')
      return
    }

    const config = await api.getPushConfig()
    if (config.error) {
      setPushMessage('Browser alerts couldn’t be checked. Check your connection and try again.')
      return
    }

    const configured = Boolean(config.data?.configured)
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!configured || !publicKey) {
      const hint = pushConfigurationHint({
        configured,
        missing: config.data?.missing || [],
        publicKey,
        admin,
      })
      setPushMessage(hint)
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Browser alerts are on for this device.')
    } catch (toggleError) {
      const detail = toggleError instanceof Error ? toggleError.message : 'Browser push could not be enabled.'
      setPushMessage(detail)
    }
  }

  return { pushEnabled, pushMessage, handleTogglePush }
}

export type BrowserAlerts = ReturnType<typeof useBrowserAlerts>
