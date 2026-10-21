import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Button } from '@/components/ui/button';
import { ALargeSmall, AtSign, Bold, Braces, Code2, Italic, Link2, List, ListOrdered, Quote, Strikethrough, Underline, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts } from '@/constants/csg-theme';
import { applyMessageFormat, applyMessageLink, messageFormatIsActive, type ComposerSelection, type MessageFormatAction } from '@/lib/message-formatting';
import { messageBodyWithinLimit } from '@/lib/message-compose';

type Props = {
  value: string;
  selection: ComposerSelection;
  visible: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelectionChange: (selection: ComposerSelection) => void;
  onComposerFocus: () => void;
  onLimitExceeded: () => void;
};

const ACTIONS: { action: Exclude<MessageFormatAction, 'link' | 'mention'>; label: string; Icon: LucideIcon }[] = [
  { action: 'bold', label: 'Bold', Icon: Bold },
  { action: 'italic', label: 'Italic', Icon: Italic },
  { action: 'underline', label: 'Underline', Icon: Underline },
  { action: 'strike', label: 'Strikethrough', Icon: Strikethrough },
  { action: 'bulletList', label: 'Bulleted list', Icon: List },
  { action: 'orderedList', label: 'Numbered list', Icon: ListOrdered },
  { action: 'quote', label: 'Block quote', Icon: Quote },
  { action: 'inlineCode', label: 'Inline code', Icon: Code2 },
  { action: 'codeBlock', label: 'Code block', Icon: Braces },
];

export function FormattingToggleButton({ expanded, disabled, onPress }: { expanded: boolean; disabled?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide formatting tools' : 'Show formatting tools'}
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.toggle, expanded && styles.activeButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <ALargeSmall color={expanded ? c.text.body : c.text.body} size={20} />
    </Pressable>
  );
}

export function MessageFormattingToolbar({ value, selection, visible, disabled, onChange, onSelectionChange, onComposerFocus, onLimitExceeded }: Props) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('https://');
  const active = useMemo(() => new Set(ACTIONS.filter(({ action }) => messageFormatIsActive(value, selection, action)).map(({ action }) => action)), [selection, value]);


  const commit = (next: { value: string; selection: ComposerSelection }) => {
    if (!messageBodyWithinLimit(next.value)) {
      onLimitExceeded();
      return;
    }
    onChange(next.value);
    onSelectionChange(next.selection);
    requestAnimationFrame(onComposerFocus);
  };

  const format = (action: Exclude<MessageFormatAction, 'link'>) => commit(applyMessageFormat(value, selection, action));
  const applyLink = () => {
    const href = url.trim();
    if (!/^https?:\/\/\S+$/i.test(href)) return;
    setLinkOpen(false);
    commit(applyMessageLink(value, selection, href));
    setUrl('https://');
  };

  return (
    <>
      <View
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        pointerEvents={visible ? 'auto' : 'none'}
        style={[styles.clip, { height: visible ? 53 : 0, opacity: visible ? 1 : 0 }]}
      >
        <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel="Message formatting">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.actions}>
            {ACTIONS.map(({ action, label, Icon }) => (
              <FormatButton key={action} label={label} Icon={Icon} active={active.has(action)} disabled={disabled} onPress={() => format(action)} />
            ))}
            <FormatButton label="Add link" Icon={Link2} disabled={disabled} onPress={() => setLinkOpen(true)} />
            <FormatButton label="Mention someone" Icon={AtSign} disabled={disabled} onPress={() => format('mention')} />
          </ScrollView>
        </View>
      </View>
      <Modal visible={visible && linkOpen} transparent animationType="fade" onRequestClose={() => setLinkOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel adding link" style={StyleSheet.absoluteFill} onPress={() => setLinkOpen(false)} />
          <View style={styles.linkCard}>
            <Text accessibilityRole="header" style={styles.linkTitle}>Add a link</Text>
            <Text style={styles.linkCopy}>{selection.start === selection.end ? 'Enter the address, then replace the selected “link text”.' : 'The selected text will be used as the link label.'}</Text>
            <TextInput keyboardAppearance={scheme}
              accessibilityLabel="Link address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType="url"
              onChangeText={setUrl}
              onSubmitEditing={applyLink}
              placeholder="https://example.com"
              placeholderTextColor={c.text.body}
              returnKeyType="done"
              selectTextOnFocus
              style={styles.linkInput}
              value={url}
            />
            <View style={styles.linkActions}>
              <Button accessibilityRole="button" onPress={() => setLinkOpen(false)} style={styles.cancel} variant="quiet" label="Cancel" textStyle={styles.cancelText} />
              <Pressable accessibilityRole="button" disabled={!/^https?:\/\/\S+$/i.test(url.trim())} onPress={applyLink} style={[styles.add, !/^https?:\/\/\S+$/i.test(url.trim()) && styles.disabled]}><Text style={styles.addText}>Add link</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function FormatButton({ label, Icon, active = false, disabled, onPress }: { label: string; Icon: LucideIcon; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, active && styles.activeButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Icon color={active ? c.text.body : c.text.body} size={19} strokeWidth={active ? 2.5 : 2} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: c.surface.raised },
  bar: { height: 53, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised, justifyContent: 'center' },
  actions: { paddingHorizontal: 10, paddingVertical: 4, gap: 3, alignItems: 'center' },
  button: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  toggle: { width: 44, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  activeButton: { backgroundColor: c.selection.bg, borderWidth: 1, borderColor: c.selection.indicator },
  disabled: { opacity: 0.38 },
  pressed: { transform: [{ scale: 0.94 }] },
  modalRoot: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', paddingHorizontal: 22 },
  linkCard: { borderRadius: 22, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 20 },
  linkTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 19 },
  linkCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 5 },
  linkInput: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.page, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, marginTop: 16 },
  linkActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 16 },
  cancel: { minHeight: 44, borderRadius: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 13 },
  add: { minHeight: 44, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.selection.bg },
  addText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
}));
