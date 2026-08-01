import * as Clipboard from 'expo-clipboard';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

import { fontScaleLimits, fonts, palette, typography } from '@/constants/csg-theme';

type Props = {
  code: string;
  language?: string;
};

const OVERFLOW_TOLERANCE = 2;
const COPIED_RESET_MS = 2_000;
const CODE_HORIZONTAL_PADDING = 24;
const MENLO_CHARACTER_WIDTH = 7.25;
const TAB_COLUMNS = 4;

function estimatedCodeWidth(code: string) {
  const longestLine = Math.max(0, ...code.split('\n').map((line) =>
    Array.from(line).reduce((columns, character) => {
      if (character === '\t') return columns + TAB_COLUMNS;
      return columns + ((character.codePointAt(0) ?? 0) > 0x7f ? 2 : 1);
    }, 0),
  ));
  return longestLine * MENLO_CHARACTER_WIDTH;
}

export function MessageCodeBlock({ code, language = '' }: Props) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [codeWidth, setCodeWidth] = useState(0);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimatedWidth = useMemo(() => estimatedCodeWidth(code), [code]);
  const intrinsicContentWidth = Math.ceil(Math.max(codeWidth, estimatedWidth)) + CODE_HORIZONTAL_PADDING;
  const overflowing = viewportWidth > 0 && intrinsicContentWidth > viewportWidth + OVERFLOW_TOLERANCE;
  const maxOffset = Math.max(0, intrinsicContentWidth - viewportWidth);
  const canScrollLeft = horizontalOffset > OVERFLOW_TOLERANCE;
  const canScrollRight = maxOffset - horizontalOffset > OVERFLOW_TOLERANCE;

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  const measureViewport = (event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  };

  const measureCode = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const widestLine = Math.max(0, ...event.nativeEvent.lines.map((line) => line.width));
    setCodeWidth((current) => Math.abs(current - widestLine) > OVERFLOW_TOLERANCE ? widestLine : current);
  };

  const pageCode = (direction: -1 | 1) => {
    const page = Math.max(80, viewportWidth * 0.72);
    const x = Math.min(maxOffset, Math.max(0, horizontalOffset + direction * page));
    scrollRef.current?.scrollTo({ animated: true, x, y: 0 });
  };

  return (
    <View style={styles.block} testID="message-code-block">
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={fontScaleLimits.utility} numberOfLines={1} style={styles.language}>{language || 'Code'}</Text>
        <View style={styles.headerActions}>
          {overflowing && (
            <View style={styles.overflowActions}>
              <View accessible accessibilityLabel="Code continues horizontally" style={styles.overflowLabel}>
                <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.overflowText}>Scroll</Text>
              </View>
              {canScrollLeft && (
                <Pressable accessibilityLabel="Scroll code left" accessibilityRole="button" onPress={() => pageCode(-1)} style={({ pressed }) => [styles.pageButton, pressed && styles.pressed]}>
                  <ChevronLeft color={palette.muted} size={15} />
                </Pressable>
              )}
              {canScrollRight && (
                <Pressable accessibilityLabel="Scroll code right" accessibilityRole="button" onPress={() => pageCode(1)} style={({ pressed }) => [styles.pageButton, pressed && styles.pressed]}>
                  <ChevronRight color={palette.muted} size={15} />
                </Pressable>
              )}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Code copied' : 'Copy code'}
            accessibilityHint="Copies the complete code block"
            hitSlop={4}
            onPress={() => { void copy(); }}
            style={({ pressed }) => [styles.copyButton, copied && styles.copyButtonCopied, pressed && styles.pressed]}
          >
            {copied ? <Check color={palette.success} size={15} /> : <Copy color={palette.muted} size={15} />}
            <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={[styles.copyText, copied && styles.copyTextCopied]}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
      </View>
      <View onLayout={measureViewport} style={styles.viewport} testID="message-code-viewport">
        <ScrollView
          ref={scrollRef}
          accessibilityLabel={overflowing ? 'Code block, scroll horizontally for more' : 'Code block'}
          alwaysBounceHorizontal={false}
          bounces={overflowing}
          contentContainerStyle={[
            styles.scrollContent,
            viewportWidth > 0 && { minWidth: Math.max(viewportWidth, intrinsicContentWidth) },
          ]}
          decelerationRate="fast"
          directionalLockEnabled
          horizontal
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => setHorizontalOffset(event.nativeEvent.contentOffset.x)}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={overflowing}
          style={styles.scroller}
          testID="message-code-scroller"
        >
          <Text maxFontSizeMultiplier={fontScaleLimits.utility} onTextLayout={measureCode} style={styles.code} testID="message-code-text">{code}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#080A0E',
    borderWidth: 1,
    borderColor: '#303542',
  },
  header: {
    minHeight: 44,
    paddingLeft: 12,
    paddingRight: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#303542',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  language: {
    flexShrink: 1,
    color: '#B5BBC8',
    fontFamily: fonts.bold,
    ...typography.label,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  overflowActions: { flexDirection: 'row', alignItems: 'center' },
  overflowLabel: { minHeight: 32, flexDirection: 'row', alignItems: 'center', paddingLeft: 7 },
  overflowText: { ...typography.label, color: palette.muted, fontFamily: fonts.semibold },
  pageButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  copyButton: {
    minWidth: 68,
    minHeight: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  copyButtonCopied: { backgroundColor: 'rgba(48, 184, 120, 0.1)' },
  copyText: { ...typography.label, color: palette.muted, fontFamily: fonts.semibold },
  copyTextCopied: { color: palette.success },
  pressed: { opacity: 0.66 },
  viewport: { maxWidth: '100%' },
  scroller: { flexGrow: 0, maxWidth: '100%' },
  scrollContent: { alignItems: 'flex-start', paddingHorizontal: 12, paddingVertical: 10 },
  code: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    color: '#E5E7EB',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    ...typography.code,
  },
});
