import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/back-button';
import { useTheme } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { canHandoff } from '@/lib/web-handoff-policy';
export default function LinkUnavailable() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  const { api, user } = useSession();
  const { colors: c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = canHandoff(path, user);
  return <View style={{ flex: 1, padding: 24, paddingTop: 64, gap: 20, backgroundColor: c.surface.page }}>
    <BackButton /><Text accessibilityRole="header" style={{ color: c.text.strong, fontSize: 24 }}>This link needs the web app</Text>
    <Text style={{ color: c.text.body }}>{allowed ? 'This page is available in the web app.' : 'This link cannot be opened here. Return to your courses, or use the website in your browser.'}</Text>
    {allowed && <Button label="Open on the web" loading={busy} onPress={() => { setBusy(true); setError(''); void openAuthenticatedWebPage(api, path!).catch(() => setError('Could not open this page. Try again.')).finally(() => setBusy(false)); }} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.text.body }}>{error}</Text>}
  </View>;
}
