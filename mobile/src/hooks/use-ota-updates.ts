import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

export const OTA_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Download only. Native expo-updates applies the result on the next cold start. */
export function useOtaUpdates() {
  const [isUpdateReady, setUpdateReady] = useState(false);
  const lastAttempt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !Updates.isEnabled) return;
    mounted.current = true;

    const check = async () => {
      const now = Date.now();
      // Throttle failures too; foregrounding must not hammer EAS while offline.
      if (inFlight.current || (lastAttempt.current !== null && now >= lastAttempt.current && now - lastAttempt.current < OTA_CHECK_INTERVAL_MS)) return;
      lastAttempt.current = now;
      inFlight.current = true;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable && !update.isRollBackToEmbedded) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (mounted.current && (fetched.isNew || fetched.isRollBackToEmbedded)) setUpdateReady(true);
        // Never call reloadAsync: drafts, recordings, uploads, and submissions
        // may still be in progress, including outside React Query mutations.
      } catch (error) {
        console.warn('[OTA] Update check/download failed', error);
      } finally {
        inFlight.current = false;
      }
    };

    if (AppState.currentState === 'active' || AppState.currentState === null) void check();
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && previousState !== 'active') void check();
      previousState = state;
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  return isUpdateReady;
}
