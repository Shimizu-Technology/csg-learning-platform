import { StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/csg-theme';

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.text, { fontSize: size * 0.31 }]}>{initials}</Text></View>;
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#293041', borderWidth: 1, borderColor: '#3B4356' },
  text: { color: palette.paper, fontFamily: fonts.bold, letterSpacing: 0.3 },
});
