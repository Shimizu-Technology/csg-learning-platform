import { useContext, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { PressableScale } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  closeDisabled?: boolean;
  scrollable?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Shared native bottom sheet with slide presentation, grab handle,
 * backdrop tap-to-dismiss, and safe-area bottom inset.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  closeDisabled = false,
  scrollable = true,
  children,
  footer,
}: BottomSheetProps) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const reducedMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext);
  const bottomPad = Math.max(insets?.bottom ?? 0, 16);

  const handleClose = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={handleClose}>
      <View style={styles.root}>
        <Pressable
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
        />
        <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
          <View style={styles.handle} />
          {title ? (
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>
                {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Close ${title}`}
                disabled={closeDisabled}
                onPress={handleClose}
                style={styles.closeButton}
              >
                <X color={c.text.body} size={20} />
              </PressableScale>
            </View>
          ) : null}
          {scrollable ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.scrollContent}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: c.overlay,
  },
  sheet: {
    backgroundColor: c.surface.raised,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.subtle,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: '85%',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  subtitle: { color: c.text.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 10, paddingBottom: 8 },
  footer: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
}));
