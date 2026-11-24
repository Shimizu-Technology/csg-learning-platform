import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { AlertCircle, Globe } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/back-button';
import { fonts, fontScaleLimits, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';
import { openAuthenticatedWebPage } from '@/lib/external-links';
import { canHandoff } from '@/lib/web-handoff-policy';
export default function LinkUnavailable() {
  const { path } = useLocalSearchParams<{ path?: string }>();
  const router = useRouter();
  const { api, user } = useSession();
  const styles = useStyles();
  const { colors: c } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = canHandoff(path, user);
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.header}><BackButton style={styles.back} /><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.kicker}>LINK</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.icon}>{allowed ? <Globe color={c.text.body} size={22} /> : <AlertCircle color={c.text.body} size={22} />}</View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.title} style={styles.title}>{allowed ? 'This link needs the web app' : 'Page unavailable'}</Text>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.copy}>{allowed ? 'This page is available in the web app.' : 'This link isn’t available for your account or can’t be opened in the app.'}</Text>
      {allowed ? (
        <Button label="Open on the web" loading={busy} onPress={() => { setBusy(true); setError(''); void openAuthenticatedWebPage(api, path!).catch(() => setError('Could not open this page. Try again.')).finally(() => setBusy(false)); }} />
      ) : (
        <Button label="Go to Today" onPress={() => router.replace('/(tabs)' as Href)} />
      )}
      {!!error && <Text accessibilityRole="alert" style={styles.copy}>{error}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  back: { width: 44, height: 44, borderRadius: 14 },
  kicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 },
  content: { padding: 24, gap: 14 },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: c.text.strong, fontFamily: fonts.extraBold },
  copy: { ...typography.body, color: c.text.body, fontFamily: fonts.regular },
}));
