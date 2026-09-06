import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { updatesKeys } from '@/lib/updates-cache';

export const UPDATES_STALE_TIME = 60_000;

/** Refetches stale active Update queries once each time the screen gains focus. */
export function useUpdatesFocusRefresh(userId: number, demo: boolean) {
  const queryClient = useQueryClient();

  useFocusEffect(useCallback(() => {
    if (demo || !userId) return;
    void queryClient.refetchQueries(
      { queryKey: updatesKeys.root(userId), type: 'active', stale: true },
      { cancelRefetch: false },
    );
  }, [demo, queryClient, userId]));
}
