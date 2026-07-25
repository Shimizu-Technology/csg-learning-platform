import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { formatFileSize } from '@/lib/attachments';
import type { Message } from '@/lib/types';

type Attachment = Message['attachments'][number];

type Props = {
  attachments: Attachment[];
  initialAttachmentId: number | null;
  onClose: () => void;
};

export function ImagePreview({ attachments, initialAttachmentId, onClose }: Props) {
  const initialIndex = Math.max(0, attachments.findIndex((attachment) => attachment.id === initialAttachmentId));
  const [index, setIndex] = useState(initialIndex);

  const attachment = attachments[index] || null;
  const position = useMemo(() => attachments.length > 1 ? `${index + 1} of ${attachments.length}` : 'Image preview', [attachments.length, index]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen" visible={Boolean(attachment)}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close image preview" onPress={onClose} style={styles.iconButton}>
            <X color={palette.text} size={22} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.filename}>{attachment?.filename}</Text>
            <Text style={styles.position}>{position}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share image"
            disabled={!attachment?.url}
            onPress={() => attachment?.url && void Share.share({ title: attachment.filename, url: attachment.url, message: attachment.url })}
            style={styles.iconButton}
          >
            <Share2 color={palette.text} size={20} />
          </Pressable>
        </View>

        <View style={styles.stage}>
          {attachment?.url && <Image accessibilityLabel={attachment.filename} resizeMode="contain" source={{ uri: attachment.url }} style={styles.image} />}
          {attachments.length > 1 && index > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Previous image" onPress={() => setIndex((current) => Math.max(0, current - 1))} style={[styles.nav, styles.previous]}>
              <ChevronLeft color={palette.text} size={24} />
            </Pressable>
          )}
          {attachments.length > 1 && index < attachments.length - 1 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Next image" onPress={() => setIndex((current) => Math.min(attachments.length - 1, current + 1))} style={[styles.nav, styles.next]}>
              <ChevronRight color={palette.text} size={24} />
            </Pressable>
          )}
        </View>

        <View style={styles.footer}>
          <Text numberOfLines={1} style={styles.footerName}>{attachment?.filename}</Text>
          <Text style={styles.footerMeta}>{attachment ? formatFileSize(attachment.byte_size) : ''}</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050609' },
  header: { minHeight: 68, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconButton: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line },
  headerCopy: { flex: 1, minWidth: 0, alignItems: 'center' },
  filename: { color: palette.text, fontFamily: fonts.semibold, fontSize: 13, maxWidth: '100%' },
  position: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginTop: 2 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  nav: { position: 'absolute', top: '50%', marginTop: -24, width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,21,29,0.9)', borderWidth: 1, borderColor: palette.line },
  previous: { left: 12 },
  next: { right: 12 },
  footer: { minHeight: 64, paddingHorizontal: 20, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  footerName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 },
  footerMeta: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginTop: 3 },
});
