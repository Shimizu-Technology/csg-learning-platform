import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/button';
import type { StarterLinkContext } from '@/components/authored-content';
import { LessonMarkdown } from '@/components/lesson-markdown';
import { fonts, monoFont } from '@/constants/csg-theme';
import { isHtmlSource } from '@/lib/authored-content';
import { composerInputBehavior } from '@/lib/composer-input';
import { makeStyles, useTheme } from '@/providers/theme-provider';

/** Source is never parsed or serialized on the editing path. */
export function StaffMarkdownEditor({ value, onChange, accessibilityLabel = 'Exercise instructions', starterLinks }: {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  starterLinks?: StarterLinkContext;
}) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const [preview, setPreview] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  // Older rich-text bodies are HTML; saving keeps them byte-for-byte, so name them honestly.
  const html = isHtmlSource(value);
  const inputBehavior = html
    ? { autoCorrect: false, spellCheck: false, autoCapitalize: 'none' as const, smartInsertDelete: false }
    : composerInputBehavior(value, selection);
  return <View style={styles.container}>
    <View style={styles.header}>
      <Text style={styles.helper}>{html ? 'HTML source' : 'Markdown'}</Text>
      <Button variant="secondary" label={preview ? html ? 'Edit source' : 'Edit Markdown' : 'Preview instructions'} accessibilityLabel={`${preview ? 'Edit' : 'Preview'} ${accessibilityLabel}`} onPress={() => setPreview(!preview)} />
    </View>
    {preview ? <View style={styles.preview}><LessonMarkdown body={value} starterLinks={starterLinks} /></View> : <TextInput
      keyboardAppearance={scheme}
      accessibilityLabel={accessibilityLabel}
      {...inputBehavior}
      multiline
      textAlignVertical="top"
      value={value}
      selection={selection}
      onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
      onChangeText={onChange}
      placeholder="Write lesson instructions in Markdown…"
      placeholderTextColor={c.text.body}
      style={styles.input}
    />}
  </View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  container: { gap: 8 },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  helper: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12 },
  input: { minHeight: 220, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: monoFont, fontSize: 16, lineHeight: 24, padding: 13 },
  preview: { padding: 13, borderRadius: 16, backgroundColor: c.surface.raised },
}));
