import { switchColors } from '@/constants/csg-theme';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Braces, Gem } from 'lucide-react-native';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
import type { CodeRunnerConfig, CodeRunnerLanguage } from '@/lib/code-runner';

export function StaffCodeRunnerSettings({ value, onChange }: { value: CodeRunnerConfig; onChange: (value: CodeRunnerConfig) => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const selectLanguage = (language: CodeRunnerLanguage) => onChange({ ...value, language });

  return <View style={styles.card}>
    <View style={styles.toggleRow}>
      <View style={styles.icon}><Braces color={value.enabled ? c.selection.indicator : c.text.body} size={19} /></View>
      <View style={styles.flex}><Text style={styles.title}>Browser code runner</Text><Text style={styles.copy}>Let students run starter code for practice. Running code does not grade or submit their work.</Text></View>
      <Switch accessibilityLabel="Enable browser code runner" value={value.enabled} onValueChange={(enabled) => onChange({ ...value, enabled })} {...switchColors(c, value.enabled)}  />
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
  const styles = useStyles();
  const { colors: c } = useTheme();
  const Icon = language === 'ruby' ? Gem : Braces;
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onPress(language)} style={[styles.language, selected && styles.languageActive]}><Icon color={selected ? c.selection.indicator : c.text.body} size={17} /><Text style={[styles.languageText, selected && styles.languageTextActive]}>{label}</Text></Pressable>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  card: { borderRadius: 17, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, overflow: 'hidden' },
  toggleRow: { minHeight: 86, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 3 },
  languageSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, padding: 13, gap: 8 },
  label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 },
  languages: { flexDirection: 'row', gap: 8 },
  language: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  languageActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 },
  languageText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  languageTextActive: { color: c.text.strong, fontFamily: fonts.extraBold },
  handoff: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
}));
