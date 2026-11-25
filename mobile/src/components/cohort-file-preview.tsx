import { X } from 'lucide-react-native';
import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthoredContent } from '@/components/authored-content';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts, monoFont } from '@/constants/csg-theme';
import { CSV_PREVIEW_LIMITS, parseCsv, safeHttpsUrl, type CohortFilePreview } from '@/lib/cohort-files';
import { makeStyles, useTheme } from '@/providers/theme-provider';

/**
 * In-app preview for text, Markdown, CSV and images. The API reads text files
 * itself, so nothing is fetched from storage here except an image's short-lived
 * inline link. Markdown renders as written text: raw HTML shows as typed.
 */
export function CohortFilePreviewModal({ title, preview, onClose, onDownload }: { title: string; preview: CohortFilePreview | null; onClose: () => void; onDownload: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const image = preview?.preview_mode === 'image' ? safeHttpsUrl(preview.url) : null;
  return <Modal visible={Boolean(preview)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.flex}><Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>{preview && <Text style={styles.meta}>{preview.filename}{preview.version_number > 1 ? ` · Version ${preview.version_number}` : ''}</Text>}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.close}><X color={c.text.body} size={20} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {preview?.truncated && <Text style={styles.notice}>Showing the first 512 KB. Download the file to see all of it.</Text>}
        {preview?.preview_mode === 'markdown' && <AuthoredContent body={preview.text || ''} compact written />}
        {preview?.preview_mode === 'text' && <Text selectable style={styles.mono}>{preview.text}</Text>}
        {preview?.preview_mode === 'csv' && <CsvTable text={preview.text || ''} />}
        {image && <Image accessibilityLabel={title} source={{ uri: image }} resizeMode="contain" style={styles.image} />}
      </ScrollView>
      <View style={styles.footer}><Button variant="secondary" label="Download" accessibilityLabel={`Download ${title}`} onPress={onDownload} /></View>
    </SafeAreaView>
  </Modal>;
}

function CsvTable({ text }: { text: string }) {
  const styles = useStyles();
  const { rows, clippedRows, clippedColumns } = parseCsv(text);
  if (!rows.length) return <Text style={styles.meta}>This CSV file is empty.</Text>;
  const clipped = [clippedRows && `${CSV_PREVIEW_LIMITS.rows} rows`, clippedColumns && `${CSV_PREVIEW_LIMITS.columns} columns`].filter(Boolean).join(' and ');
  return <View style={styles.csv}>{clipped ? <Text style={styles.notice}>Showing the first {clipped}. Download the file to see all of it.</Text> : null}<ScrollView horizontal accessibilityLabel="CSV preview">
    <View style={styles.table}>{rows.map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>{row.map((cell, index) => <Text key={index} numberOfLines={3} style={[styles.cell, rowIndex === 0 && styles.headCell]}>{cell}</Text>)}</View>)}</View>
  </ScrollView></View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  flex: { flex: 1, minWidth: 0 }, title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17 }, meta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  close: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 12 }, notice: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, borderRadius: 12, backgroundColor: c.surface.sunken, padding: 12 },
  mono: { color: c.text.strong, fontFamily: monoFont, fontSize: 13, lineHeight: 19 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: c.surface.sunken },
  csv: { gap: 10 }, table: { borderWidth: 1, borderColor: c.border.subtle, borderRadius: 12, overflow: 'hidden' }, tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle }, tableHead: { backgroundColor: c.surface.sunken, borderTopWidth: 0 },
  cell: { width: 140, paddingHorizontal: 10, paddingVertical: 8, color: c.text.body, fontFamily: fonts.regular, fontSize: 12 }, headCell: { color: c.text.strong, fontFamily: fonts.bold },
  footer: { paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
}));
