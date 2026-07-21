import { Redirect, Stack, usePathname, type Href } from 'expo-router';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function AuthLayout() {
  const { loaded, signedIn } = useCsgAuth();
  const { loading, accessDenied } = useSession();
  const pathname = usePathname();
  if (!loaded || (signedIn && loading)) return null;
  if (signedIn && accessDenied && pathname !== '/access-denied') return <Redirect href={'/(auth)/access-denied' as Href} />;
  if (signedIn && !accessDenied) return <Redirect href="/(app)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
