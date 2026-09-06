import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { fonts, palette } from '@/constants/csg-theme';
import { reactionOption } from '@/lib/reactions';
import type { Message } from '@/lib/types';

type Props = {
  message: Message | null;
  initialEmoji: string | null;
  onClose: () => void;
  onToggle: (message: Message, emoji: string) => Promise<void>;
};

export function ReactionDetailsSheet({ message, initialEmoji, onClose, onToggle }: Props) {
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(initialEmoji);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => message?.reactions.find((reaction) => reaction.emoji === selectedEmoji) || message?.reactions[0] || null,
    [message, selectedEmoji],
  );
  const option = selected ? reactionOption(selected.emoji) : null;
  const SelectedIcon = option?.Icon;

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={Boolean(message)}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>MESSAGE REACTIONS</Text>
            <Text style={styles.title}>Who reacted</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close reaction details" onPress={onClose} style={styles.close}>
            <X color={palette.muted} size={21} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {message?.reactions.map((reaction) => {
            const reactionDisplay = reactionOption(reaction.emoji);
            const Icon = reactionDisplay?.Icon;
            const active = selected?.emoji === reaction.emoji;
            return (
              <Pressable
                key={reaction.emoji}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${reactionDisplay?.label || 'Reaction'}, ${reaction.count}`}
                onPress={() => setSelectedEmoji(reaction.emoji)}
                style={[styles.tab, active && styles.tabActive]}
              >
                {Icon ? <Icon color={active ? palette.rubySoft : palette.muted} size={16} /> : <Text style={styles.fallback}>{reaction.emoji}</Text>}
                <Text style={[styles.tabCount, active && styles.tabCountActive]}>{reaction.count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.people}>
          <View style={styles.summary}>
            {SelectedIcon ? <SelectedIcon color={palette.rubySoft} size={18} /> : null}
            <Text style={styles.summaryTitle}>{option?.label || 'Reaction'}</Text>
            <Text style={styles.summaryCount}>{selected?.count || 0}</Text>
          </View>
          {selected?.users.map((person, index) => (
            <View key={person.id} style={[styles.person, index > 0 && styles.personDivider]}>
              <Avatar name={person.full_name} size={38} />
              <Text style={styles.personName}>{person.full_name}</Text>
            </View>
          ))}
          {!selected?.users.length && <Text style={styles.empty}>No reactions to show.</Text>}
        </ScrollView>

        {message && selected && (
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={async () => {
                setSaving(true);
                try { await onToggle(message, selected.emoji); } finally { setSaving(false); }
              }}
              style={[styles.action, selected.reacted && styles.actionRemove, saving && styles.disabled]}
            >
              {saving && <ActivityIndicator color={selected.reacted ? palette.rubySoft : palette.text} size="small" />}
              {!saving && SelectedIcon ? <SelectedIcon color={selected.reacted ? palette.rubySoft : palette.text} size={18} /> : null}
              <Text style={[styles.actionText, selected.reacted && styles.actionRemoveText]}>
                {selected.reacted ? `Remove your ${option?.label.toLowerCase() || 'reaction'}` : `React with ${option?.label.toLowerCase() || 'this'}`}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  header: { minHeight: 80, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.6 },
  title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line },
  tabs: { paddingHorizontal: 20, paddingVertical: 14, gap: 8 },
  tab: { height: 44, minWidth: 58, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabActive: { borderColor: '#6A2A36', backgroundColor: '#2A151B' },
  tabCount: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  tabCountActive: { color: palette.rubySoft },
  fallback: { color: palette.text, fontSize: 14 },
  people: { paddingHorizontal: 20, paddingBottom: 24 },
  summary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, flex: 1 },
  summaryCount: { color: palette.muted, fontFamily: fonts.bold, fontSize: 12 },
  person: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  personName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 },
  empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 28, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  action: { minHeight: 52, borderRadius: 17, backgroundColor: palette.ruby, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  actionRemove: { backgroundColor: '#211216', borderWidth: 1, borderColor: '#4A2029' },
  actionText: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  actionRemoveText: { color: palette.rubySoft },
  disabled: { opacity: 0.55 },
});
