import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { fonts } from '@/constants/csg-theme';
import { reactionOption } from '@/lib/reactions';
import type { Message } from '@/lib/types';

type Props = {
  message: Message | null;
  initialEmoji: string | null;
  onClose: () => void;
  onToggle: (message: Message, emoji: string) => Promise<void>;
};

export function ReactionDetailsSheet({ message, initialEmoji, onClose, onToggle }: Props) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(initialEmoji);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => message?.reactions.find((reaction) => reaction.emoji === selectedEmoji) || message?.reactions[0] || null,
    [message, selectedEmoji],
  );
  const option = selected ? reactionOption(selected.emoji) : null;
  const SelectedIcon = option?.Icon;

  return (
    <Modal animationType="fade" onRequestClose={onClose} presentationStyle="pageSheet" visible={Boolean(message)}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>MESSAGE REACTIONS</Text>
            <Text style={styles.title}>Who reacted</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close reaction details" onPress={onClose} style={styles.close}>
            <X color={c.text.body} size={21} />
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
                {Icon ? <Icon color={active ? c.selection.indicator : c.text.body} size={16} /> : <Text style={styles.fallback}>{reaction.emoji}</Text>}
                <Text style={[styles.tabCount, active && styles.tabCountActive]}>{reaction.count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.people}>
          <View style={styles.summary}>
            {SelectedIcon ? <SelectedIcon color={c.text.body} size={18} /> : null}
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
              {saving && <ActivityIndicator color={selected.reacted ? c.text.body : c.text.strong} size="small" />}
              {!saving && SelectedIcon ? <SelectedIcon color={selected.reacted ? c.text.body : c.text.strong} size={18} /> : null}
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

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: { minHeight: 80, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.6 },
  title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.5, marginTop: 2 },
  close: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle },
  tabs: { paddingHorizontal: 20, paddingVertical: 14, gap: 8 },
  tab: { height: 44, minWidth: 58, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 },
  tabCount: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  tabCountActive: { color: c.text.strong, fontFamily: fonts.extraBold },
  fallback: { color: c.text.strong, fontSize: 14 },
  people: { paddingHorizontal: 20, paddingBottom: 24 },
  summary: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, flex: 1 },
  summaryCount: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  person: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12 },
  personDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  personName: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 },
  empty: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 28, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  action: { minHeight: 52, borderRadius: 17, backgroundColor: c.selection.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  actionRemove: { backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong },
  actionText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  actionRemoveText: { color: c.text.body },
  disabled: { opacity: 0.55 },
}));
