import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import { linkUrlProblem, type CohortFile } from '@/lib/cohort-files';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

/** Save an https link (Google Docs, Figma, Notion, Canva…) into a folder. Needs no file storage. */
export function CohortLinkForm({ cohortId, folders, studentId, onSaved, onCancel }: { cohortId: number; folders: string[]; studentId?: number; onSaved: (file: CohortFile) => void; onCancel: () => void }) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { api } = useSession();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(folders[0] || 'General');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = linkUrlProblem(url);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      const result = await api.createCohortLink(cohortId, { external_url: url.trim(), folder, ...(title.trim() ? { title: title.trim() } : {}), ...(studentId ? { student_id: studentId } : {}) });
      onSaved(result.file);
    } catch (failure) {
      setError((failure as Error).message || 'Could not save this link.');
    } finally {
      setSaving(false);
    }
  }

  return <View style={styles.form}>
    <Text accessibilityRole="header" style={styles.heading}>Add a link</Text>
    <TextInput keyboardAppearance={scheme} accessibilityLabel="Link" value={url} onChangeText={setUrl} placeholder="https://docs.google.com/…" placeholderTextColor={c.text.body}
      autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url" editable={!saving} style={styles.input} />
    <TextInput keyboardAppearance={scheme} accessibilityLabel="Title (optional)" value={title} onChangeText={setTitle} placeholder="Title (optional)" placeholderTextColor={c.text.body}
      maxLength={160} editable={!saving} style={styles.input} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {folders.map((preset) => <Pressable key={preset} accessibilityRole="button" accessibilityLabel={`Save to ${preset}`} accessibilityState={{ selected: folder === preset }} onPress={() => setFolder(preset)} style={[styles.chip, folder === preset && styles.selectedChip]}><Text style={[styles.chipText, folder === preset && styles.selectedChipText]}>{preset}</Text></Pressable>)}
    </ScrollView>
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.actions}>
      <Button style={styles.action} label={saving ? 'Saving…' : 'Save link'} loading={saving} disabled={saving || !url.trim()} onPress={() => void save()} />
      <Button style={styles.action} variant="secondary" label="Cancel" disabled={saving} onPress={onCancel} />
    </View>
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  form: { gap: 10, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 14 },
  heading: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.page, paddingHorizontal: 12, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  chips: { gap: 8, paddingRight: 20 }, chip: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 12 }, selectedChip: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg }, chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, selectedChipText: { color: c.text.strong },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { flexGrow: 1, minWidth: 120 },
}));
