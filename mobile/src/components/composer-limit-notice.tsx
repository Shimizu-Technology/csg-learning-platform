import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { messageBodyLength, messageBodyWithinLimit, MESSAGE_BODY_LIMIT } from '@/lib/message-compose';

export function ComposerLimitNotice({ value }: { value: string }) {
  const overLimit = !messageBodyWithinLimit(value);
  const wasOverLimitRef = useRef(false);
  const message = `Shorten this draft to ${MESSAGE_BODY_LIMIT.toLocaleString()} characters (${messageBodyLength(value).toLocaleString()} now).`;

  useEffect(() => {
    if (Platform.OS === 'ios' && overLimit && !wasOverLimitRef.current) {
      AccessibilityInfo.announceForAccessibility(message);
    }
    wasOverLimitRef.current = overLimit;
  }, [message, overLimit]);

  if (!overLimit) return null;

  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined} style={styles.notice}>
      {message}
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
