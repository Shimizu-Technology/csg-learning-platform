import { Braces, Gem } from 'lucide-react-native';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import type { CodeRunnerConfig, CodeRunnerLanguage } from '@/lib/code-runner';

export function StaffCodeRunnerSettings({ value, onChange }: { value: CodeRunnerConfig; onChange: (value: CodeRunnerConfig) => void }) {
  const selectLanguage = (language: CodeRunnerLanguage) => onChange({ ...value, language });

  return <View style={styles.card}>
    <View style={styles.toggleRow}>
      <View style={styles.icon}><Braces color={value.enabled ? palette.rubySoft : palette.muted} size={19} /></View>
      <View style={styles.flex}><Text style={styles.title}>Browser code runner</Text><Text style={styles.copy}>Let students run starter code for practice. Running code does not grade or submit their work.</Text></View>
      <Switch accessibilityLabel="Enable browser code runner" value={value.enabled} onValueChange={(enabled) => onChange({ ...value, enabled })} trackColor={{ false: palette.line, true: '#6A2A36' }} thumbColor={value.enabled ? palette.rubySoft : palette.muted} />
    </View>
    {value.enabled && <View style={styles.languageSection}>
      <Text style={styles.label}>RUNNER LANGUAGE</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Runner language" style={styles.languages}>
        <LanguageButton label="Ruby" language="ruby" selected={value.language === 'ruby'} onPress={selectLanguage} />
        <LanguageButton label="JavaScript" language="javascript" selected={value.language === 'javascript'} onPress={selectLanguage} />
      </View>
      <Text style={styles.handoff}>Students use the secure web runner from the lesson; their signed-in account carries across automatically.</Text>
    </View>}
  </View>;
}

function LanguageButton({ label, language, selected, onPress }: { label: string; language: CodeRunnerLanguage; selected: boolean; onPress: (language: CodeRunnerLanguage) => void }) {
  const Icon = language === 'ruby' ? Gem : Braces;
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onPress(language)} style={[styles.language, selected && styles.languageActive]}><Icon color={selected ? palette.rubySoft : palette.muted} size={17} /><Text style={[styles.languageText, selected && styles.languageTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, overflow: 'hidden' },
  toggleRow: { minHeight: 86, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 3 },
  languageSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, padding: 13, gap: 8 },
  label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  languages: { flexDirection: 'row', gap: 8 },
  language: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  languageActive: { borderColor: palette.ruby, backgroundColor: '#351821' },
  languageText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  languageTextActive: { color: palette.rubySoft },
  handoff: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
});
