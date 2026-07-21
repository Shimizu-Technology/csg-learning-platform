import { Redirect, type Href } from 'expo-router';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function Index() {
  const { loaded, signedIn } = useCsgAuth();
  const { loading, accessDenied } = useSession();
  if (!loaded || (signedIn && loading)) return null;
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />;
  if (accessDenied) return <Redirect href={'/(auth)/access-denied' as Href} />;
  return <Redirect href="/(app)/(tabs)" />;
}
