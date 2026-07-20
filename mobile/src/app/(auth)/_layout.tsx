import { Redirect, Stack } from 'expo-router';
import { useCsgAuth } from '@/providers/auth-provider';

export default function AuthLayout() {
  const { loaded, signedIn } = useCsgAuth();
  if (!loaded) return null;
  if (signedIn) return <Redirect href="/(app)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
