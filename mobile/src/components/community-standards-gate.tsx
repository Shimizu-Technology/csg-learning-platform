import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, typography } from '@/constants/csg-theme';
import type { CommunityPolicy } from '@/lib/types';

/**
 * Shown once before a learner joins the community. It names the account it
 * applies to and offers a way out ("Use a different account") for anyone who
 * signed in with the wrong email.
 */
export function CommunityStandardsGate({ policy, onAccept, onSignOut, accountEmail }: { policy: CommunityPolicy; onAccept: () => Promise<void>; onSignOut?: () => Promise<void> | void; accountEmail?: string | null }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (!onSignOut || signingOut || saving) return;
    setSigningOut(true); setError('');
    try { await onSignOut(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not sign out. Try again.'); }
    finally { setSigningOut(false); }
  };
  const [error, setError] = useState('');

  const accept = async () => {
    if (!agreed || saving) return;
    setSaving(true); setError('');
    try { await onAccept(); haptic('success'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not save your acceptance. Try again.'); haptic('error'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topRow}><View style={styles.icon}><ShieldCheck color={c.text.strong} size={28} /></View>{onSignOut && <Pressable accessibilityRole="button" accessibilityLabel="Use a different account" accessibilityHint="Signs out so you can sign in with another email" accessibilityState={{ disabled: saving || signingOut, busy: signingOut }} disabled={saving || signingOut} onPress={() => void signOut()} style={({ pressed }) => [styles.switchAccount, pressed && styles.pressed]}><Text style={styles.switchAccountText}>Use a different account</Text></Pressable>}</View>
        {onSignOut && !!accountEmail && <Text style={styles.accountText}>Signed in as {accountEmail}</Text>}
        <Text style={styles.eyebrow}>BEFORE YOU PARTICIPATE</Text>
        <Text accessibilityRole="header" style={styles.heading}>Keep the CSG community safe</Text>
        <Text style={styles.intro}>Review the rules that apply when you send messages, upload work, ask for help, or share files.</Text>
        <View style={styles.rules}>
          <Rule>Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</Rule>
          <Rule>Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</Rule>
          <Rule>Your learning records and content are handled as described in our Privacy Policy.</Rule>
        </View>
        <View style={styles.links}>
          <Button accessibilityRole="link" onPress={() => void Linking.openURL(policy.terms_url)} style={styles.linkButton} variant="quiet" label="Terms & Community Guidelines" textStyle={styles.link} />
          <Button accessibilityRole="link" onPress={() => void Linking.openURL(policy.privacy_url)} style={styles.linkButton} variant="quiet" label="Privacy Policy" textStyle={styles.link} />
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((value) => !value)} style={[styles.agreement, agreed && styles.agreementSelected]}>
          <View style={[styles.checkbox, agreed && styles.checkboxSelected]}>{agreed && <Check color={c.text.strong} size={16} strokeWidth={3} />}</View>
          <Text style={styles.agreementText}>I agree to the Terms and Community Guidelines and acknowledge the Privacy Policy.</Text>
        </Pressable>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Button accessibilityLabel="Agree and continue" disabled={!agreed || saving} loading={saving} onPress={() => void accept()} label={saving ? 'Saving…' : 'Agree and continue'} style={{ marginTop: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Rule({ children }: { children: string }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <View style={styles.rule}><View style={styles.ruleIcon}><Check color={c.status.success.fg} size={15} strokeWidth={3} /></View><Text style={styles.ruleText}>{children}</Text></View>; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  content: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  icon: { width: 58, height: 58, borderRadius: 20, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.7, marginTop: 24 },
  heading: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 34, lineHeight: 38, letterSpacing: -1.2, marginTop: 8 },
  intro: { color: c.text.body, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, marginTop: 12 },
  rules: { gap: 14, marginTop: 26 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  ruleIcon: { width: 26, height: 26, borderRadius: 9, backgroundColor: c.status.success.bg, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ruleText: { flex: 1, color: c.text.strong, fontFamily: fonts.medium, fontSize: 13, lineHeight: 21 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 22 },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingRight: 16 },
  link: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, textDecorationLine: 'underline' },
  agreement: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
  agreementSelected: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: c.text.body, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator },
  agreementText: { flex: 1, color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20 },
  error: { color: c.status.danger.fg, backgroundColor: c.status.danger.bg, borderRadius: 13, padding: 12, fontFamily: fonts.semibold, fontSize: 12, marginTop: 12 },
  accept: { minHeight: 52, borderRadius: 16, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, accountText: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 12 }, switchAccount: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised }, switchAccountText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  acceptDisabled: { opacity: 0.42 }, pressed: { opacity: 0.82 }, acceptText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 14 },
}));
