import { StyleSheet, Text } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { messageBodyLength, messageBodyWithinLimit, MESSAGE_BODY_LIMIT } from '@/lib/message-compose';

export function ComposerLimitNotice({ value }: { value: string }) {
  if (messageBodyWithinLimit(value)) return null;

  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
      Shorten this draft to {MESSAGE_BODY_LIMIT.toLocaleString()} characters ({messageBodyLength(value).toLocaleString()} now).
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: '#251E13',
    color: palette.warning,
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
