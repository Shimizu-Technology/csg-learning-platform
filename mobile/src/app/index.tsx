import { Redirect } from 'expo-router';
import { useCsgAuth } from '@/providers/auth-provider';

export default function Index() {
  const { loaded, signedIn } = useCsgAuth();
  if (!loaded) return null;
  return <Redirect href={signedIn ? '/(app)/(tabs)' : '/(auth)/sign-in'} />;
}
