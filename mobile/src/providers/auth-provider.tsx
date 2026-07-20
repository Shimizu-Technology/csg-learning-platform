import { useAuth, useClerk } from '@clerk/expo';
import { createContext, type PropsWithChildren, useContext, useMemo } from 'react';

import type { TokenGetter } from '@/lib/api';

interface CsgAuthValue {
  loaded: boolean;
  signedIn: boolean;
  subject: string | null;
  demo: boolean;
  getToken: TokenGetter;
  signOut: () => Promise<void>;
}

const CsgAuthContext = createContext<CsgAuthValue | null>(null);

const demoValue: CsgAuthValue = {
  loaded: true, signedIn: true, subject: 'demo', demo: true,
  getToken: async () => 'demo-token', signOut: async () => undefined,
};

export function DemoAuthProvider({ children }: PropsWithChildren) {
  return <CsgAuthContext.Provider value={demoValue}>{children}</CsgAuthContext.Provider>;
}

export function ClerkAuthProvider({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const clerk = useClerk();
  const value = useMemo<CsgAuthValue>(() => ({
    loaded: isLoaded,
    signedIn: Boolean(isSignedIn),
    subject: userId ?? null,
    demo: false,
    getToken: async ({ skipCache } = {}) => getToken({ skipCache }),
    signOut: async () => { await clerk.signOut(); },
  }), [clerk, getToken, isLoaded, isSignedIn, userId]);
  return <CsgAuthContext.Provider value={value}>{children}</CsgAuthContext.Provider>;
}

export function useCsgAuth() {
  const value = useContext(CsgAuthContext);
  if (!value) throw new Error('useCsgAuth must be used within an auth provider');
  return value;
}

export const isDemoMode = __DEV__ && process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
