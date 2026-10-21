import { makeStyles } from '@/providers/theme-provider';
import { StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/csg-theme';

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const styles = useStyles();
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}><Text allowFontScaling={false} style={[styles.text, { fontSize: Math.max(12, size * 0.31) }]}>{initials}</Text></View>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong },
  text: { color: c.text.strong, fontFamily: fonts.bold, letterSpacing: 0.3 },
}));
