import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Text } from 'react-native';

import { UPDATES_STALE_TIME, useUpdatesFocusRefresh } from '../use-updates-focus-refresh';
import { updatesKeys } from '@/lib/updates-cache';

const mockUseFocusEffect = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => mockUseFocusEffect(callback) }));

const userId = 42;

function UpdatesQueries({ announcementRequest, notificationRequest }: { announcementRequest: () => Promise<string>; notificationRequest: () => Promise<string> }) {
  useQuery({ queryKey: updatesKeys.announcements(userId, false), queryFn: announcementRequest, staleTime: UPDATES_STALE_TIME, refetchOnMount: false });
  useQuery({ queryKey: updatesKeys.notifications(userId), queryFn: notificationRequest, staleTime: UPDATES_STALE_TIME, refetchOnMount: false });
  useUpdatesFocusRefresh(userId, false);
  return <Text>Updates</Text>;
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

it('refetches each stale endpoint once on focus and stops while the 60-second cache is fresh', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const announcementRequest = jest.fn().mockResolvedValue('announcements');
  const notificationRequest = jest.fn().mockResolvedValue('notifications');
  const staleAt = Date.now() - UPDATES_STALE_TIME - 1;
  queryClient.setQueryData(updatesKeys.announcements(userId, false), 'cached announcements', { updatedAt: staleAt });
  queryClient.setQueryData(updatesKeys.notifications(userId), 'cached notifications', { updatedAt: staleAt });

  const view = render(
    <UpdatesQueries announcementRequest={announcementRequest} notificationRequest={notificationRequest} />,
    { wrapper: wrapper(queryClient) },
  );
  const focusCallback = mockUseFocusEffect.mock.calls.at(-1)?.[0] as () => void;

  act(() => focusCallback());
  await waitFor(() => {
    expect(announcementRequest).toHaveBeenCalledTimes(1);
    expect(notificationRequest).toHaveBeenCalledTimes(1);
  });

  view.rerender(<UpdatesQueries announcementRequest={announcementRequest} notificationRequest={notificationRequest} />);
  expect(mockUseFocusEffect.mock.calls.at(-1)?.[0]).toBe(focusCallback);
  act(() => focusCallback());
  await act(async () => Promise.resolve());
  expect(announcementRequest).toHaveBeenCalledTimes(1);
  expect(notificationRequest).toHaveBeenCalledTimes(1);
  view.unmount();
  queryClient.clear();
});
