import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useUser } from '@clerk/expo';
import { LogOut, RefreshCw, ShieldX } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts } from '@/constants/csg-theme';
import { useSession } from '@/providers/session-provider';

export default function AccessDeniedScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
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
        <View style={styles.icon}><ShieldX color={c.text.body} size={30} strokeWidth={2.1} /></View>
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
          {loading ? <ActivityIndicator color={c.text.onAction} /> : <RefreshCw color={c.text.onAction} size={18} />}
          <Text style={styles.primaryText}>{loading ? 'Checking access…' : 'I’ve been invited — check again'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={loading || signingOut} onPress={() => void handleSignOut()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed, (loading || signingOut) && styles.disabled]}>
          {signingOut ? <ActivityIndicator color={c.text.body} /> : <LogOut color={c.text.body} size={18} />}
          <Text style={styles.secondaryText}>{signingOut ? 'Signing out…' : 'Use a different account'}</Text>
        </Pressable>
        <Text style={styles.note}>Use the exact email address from your Code School invitation.</Text>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  glow: { position: 'absolute', top: -150, left: -70, width: 320, height: 320, borderRadius: 160, backgroundColor: c.surface.sunken, opacity: 0.8 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 32 },
  icon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, marginBottom: 24 },
  eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.7 },
  title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 32, lineHeight: 38, letterSpacing: -1.15, marginTop: 10 },
  copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, marginTop: 14 },
  account: { marginTop: 28, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised },
  accountLabel: { color: c.text.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3 },
  accountEmail: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14, marginTop: 6 },
  primary: { minHeight: 52, borderRadius: 17, backgroundColor: c.action.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 24 },
  primaryText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 14 },
  secondary: { minHeight: 52, borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10 },
  secondaryText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 14 },
  note: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
}));
