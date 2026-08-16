import { Check, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, palette, typography } from '@/constants/csg-theme';
import type { CommunityPolicy } from '@/lib/types';

export function CommunityStandardsGate({ policy, onAccept }: { policy: CommunityPolicy; onAccept: () => Promise<void> }) {
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    if (!agreed || saving) return;
    setSaving(true); setError('');
    try { await onAccept(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Could not save your acceptance. Try again.'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}><ShieldCheck color={palette.text} size={28} /></View>
        <Text style={styles.eyebrow}>BEFORE YOU PARTICIPATE</Text>
        <Text accessibilityRole="header" style={styles.heading}>Keep the CSG community safe</Text>
        <Text style={styles.intro}>Review the rules that apply when you send messages, upload work, ask for help, or share files.</Text>
        <View style={styles.rules}>
          <Rule>Be respectful. Harassment, threats, hate, sexual content, scams, and sharing private information are prohibited.</Rule>
          <Rule>Use report and block tools when something feels unsafe or inappropriate. Authorized staff review reports.</Rule>
          <Rule>Your learning records and content are handled as described in our Privacy Policy.</Rule>
        </View>
        <View style={styles.links}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(policy.terms_url)} style={styles.linkButton}><Text style={styles.link}>Terms & Community Guidelines</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(policy.privacy_url)} style={styles.linkButton}><Text style={styles.link}>Privacy Policy</Text></Pressable>
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((value) => !value)} style={[styles.agreement, agreed && styles.agreementSelected]}>
          <View style={[styles.checkbox, agreed && styles.checkboxSelected]}>{agreed && <Check color={palette.text} size={16} strokeWidth={3} />}</View>
          <Text style={styles.agreementText}>I agree to the Terms and Community Guidelines and acknowledge the Privacy Policy.</Text>
        </Pressable>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={!agreed || saving} onPress={() => void accept()} style={({ pressed }) => [styles.accept, (!agreed || saving) && styles.acceptDisabled, pressed && styles.pressed]}><Text style={styles.acceptText}>{saving ? 'Saving…' : 'Agree and enter CSG Connect'}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Rule({ children }: { children: string }) { return <View style={styles.rule}><View style={styles.ruleIcon}><Check color={palette.success} size={15} strokeWidth={3} /></View><Text style={styles.ruleText}>{children}</Text></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  icon: { width: 58, height: 58, borderRadius: 20, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...typography.label, color: palette.rubySoft, fontFamily: fonts.bold, letterSpacing: 1.7, marginTop: 24 },
  heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, lineHeight: 38, letterSpacing: -1.2, marginTop: 8 },
  intro: { color: palette.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, marginTop: 12 },
  rules: { gap: 14, marginTop: 26 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  ruleIcon: { width: 26, height: 26, borderRadius: 9, backgroundColor: '#14271F', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ruleText: { flex: 1, color: palette.text, fontFamily: fonts.medium, fontSize: 13, lineHeight: 21 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 22 },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingRight: 16 },
  link: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 12, textDecorationLine: 'underline' },
  agreement: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
  agreementSelected: { borderColor: '#6A2A36', backgroundColor: '#201319' },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: palette.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { backgroundColor: palette.ruby, borderColor: palette.ruby },
  agreementText: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20 },
  error: { color: palette.rubySoft, backgroundColor: '#2A151B', borderRadius: 13, padding: 12, fontFamily: fonts.semibold, fontSize: 12, marginTop: 12 },
  accept: { minHeight: 52, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 16 },
  acceptDisabled: { opacity: 0.42 }, pressed: { opacity: 0.82 }, acceptText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
});
