import { PostHogProvider } from 'posthog-react-native';
import { type PropsWithChildren, useEffect } from 'react';

import { analyticsClient } from '@/lib/analytics';
import { useSession } from './session-provider';

function AnalyticsIdentity() {
  const { user } = useSession();

  useEffect(() => {
    if (!analyticsClient) return;
    if (user) analyticsClient.identify(String(user.id), { role: user.role });
    else analyticsClient.reset();
  }, [user]);

  return null;
}

export function AnalyticsProvider({ children }: PropsWithChildren) {
  if (!analyticsClient) return children;
  return <PostHogProvider autocapture={false} client={analyticsClient}><AnalyticsIdentity />{children}</PostHogProvider>;
}
