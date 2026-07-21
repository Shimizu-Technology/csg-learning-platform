import { useUser } from '@clerk/expo';
import { LogOut, RefreshCw, ShieldX } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { useSession } from '@/providers/session-provider';

export default function AccessDeniedScreen() {
  const { user: clerkUser } = useUser();
  const { error, loading, refresh, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const email = clerkUser?.primaryEmailAddress?.emailAddress;

  const handleSignOut = async () => {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.glow} />
      <View style={styles.content}>
        <View style={styles.icon}><ShieldX color={palette.rubySoft} size={30} strokeWidth={2.1} /></View>
        <Text style={styles.eyebrow}>PRIVATE COHORT ACCESS</Text>
        <Text style={styles.title}>This account isn’t on the class list.</Text>
        <Text style={styles.copy}>{error || 'Ask a Code School administrator to invite the email address you use to sign in.'}</Text>

        {email && (
          <View style={styles.account}>
            <Text style={styles.accountLabel}>SIGNED IN AS</Text>
            <Text style={styles.accountEmail}>{email}</Text>
          </View>
        )}

        <Pressable accessibilityRole="button" disabled={loading || signingOut} onPress={() => void refresh()} style={({ pressed }) => [styles.primary, pressed && styles.pressed, (loading || signingOut) && styles.disabled]}>
          {loading ? <ActivityIndicator color={palette.text} /> : <RefreshCw color={palette.text} size={18} />}
          <Text style={styles.primaryText}>{loading ? 'Checking access…' : 'I’ve been invited — check again'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={loading || signingOut} onPress={() => void handleSignOut()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed, (loading || signingOut) && styles.disabled]}>
          {signingOut ? <ActivityIndicator color={palette.muted} /> : <LogOut color={palette.muted} size={18} />}
          <Text style={styles.secondaryText}>{signingOut ? 'Signing out…' : 'Use a different account'}</Text>
        </Pressable>
        <Text style={styles.note}>Use the exact email address from your Code School invitation.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  glow: { position: 'absolute', top: -150, left: -70, width: 320, height: 320, borderRadius: 160, backgroundColor: '#2B1218', opacity: 0.8 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 32 },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A151B', borderWidth: 1, borderColor: '#5E2732', marginBottom: 24 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.7 },
  title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 32, lineHeight: 38, letterSpacing: -1.15, marginTop: 10 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, marginTop: 14 },
  account: { marginTop: 28, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel },
  accountLabel: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.3 },
  accountEmail: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 6 },
  primary: { minHeight: 52, borderRadius: 17, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 24 },
  primaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
  secondary: { minHeight: 52, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10 },
  secondaryText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 14 },
  note: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
});
