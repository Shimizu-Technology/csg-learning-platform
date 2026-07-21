import { AlertCircle, MessageSquareText } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/csg-theme';

export function LoadingState({ label = 'Loading conversations' }: { label?: string }) {
  return <View style={styles.center}><ActivityIndicator color={palette.rubySoft} /><Text style={styles.muted}>{label}</Text></View>;
}

export function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.empty}><View style={styles.icon}><MessageSquareText color={palette.rubySoft} size={24} /></View><Text style={styles.title}>{title}</Text><Text style={styles.muted}>{copy}</Text></View>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <View style={styles.empty}><AlertCircle color={palette.warning} size={28} /><Text style={styles.title}>Couldn’t load this</Text><Text style={styles.muted}>{message}</Text>{retry && <Pressable accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>}</View>;
}

const styles = StyleSheet.create({
  center: { paddingVertical: 80, alignItems: 'center', gap: 14 },
  empty: { margin: 20, padding: 28, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, alignItems: 'center', gap: 10 },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#2B151B', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 },
  muted: { color: palette.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 44, paddingHorizontal: 20, borderRadius: 14, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  buttonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
});
