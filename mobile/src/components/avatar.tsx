import { makeStyles } from '@/providers/theme-provider';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/csg-theme';

export function Avatar({
  name,
  size = 44,
  uri,
  online = false,
}: {
  name: string;
  size?: number;
  uri?: string | null;
  online?: boolean;
}) {
  const styles = useStyles();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  const showImage = Boolean(uri && uri !== failedUri);
  const dotSize = Math.max(10, Math.round(size * 0.27));

  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
        {showImage ? (
          <Image
            source={{ uri: uri! }}
            onError={() => setFailedUri(uri!)}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text allowFontScaling={false} style={[styles.text, { fontSize: Math.max(12, size * 0.31) }]}>{initials}</Text>
        )}
      </View>
      {online && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.onlineDot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
            },
          ]}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, overflow: 'hidden' },
  text: { color: c.text.strong, fontFamily: fonts.bold, letterSpacing: 0.3 },
  onlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    backgroundColor: c.status.success.fg,
    borderWidth: 2,
    borderColor: c.surface.page,
  },
}));
