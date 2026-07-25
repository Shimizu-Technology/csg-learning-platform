/* eslint-disable react-hooks/immutability -- Reanimated SharedValue.value is intentionally mutable inside UI-thread worklets. */
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft, ChevronRight, RefreshCw, Share2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, palette } from '@/constants/csg-theme';
import { formatFileSize } from '@/lib/attachments';
import {
  IMAGE_VIEWER_DOUBLE_TAP_SCALE,
  IMAGE_VIEWER_MAX_SCALE,
  clamp,
  clampImageTranslation,
  createSerialTaskQueue,
  zoomTranslationAtPoint,
} from '@/lib/image-viewer';
import type { Message } from '@/lib/types';

type Attachment = Message['attachments'][number];
type Size = { width: number; height: number };

type Props = {
  attachments: Attachment[];
  initialAttachmentId: number | null;
  onClose: () => void;
};

const spring = { damping: 22, stiffness: 260, mass: 0.75 };
const queueOrientationTransition = createSerialTaskQueue();

export function ImagePreview({ attachments, initialAttachmentId, onClose }: Props) {
  const initialIndex = Math.max(0, attachments.findIndex((attachment) => attachment.id === initialAttachmentId));
  const [index, setIndex] = useState(initialIndex);
  const attachment = attachments[index] || null;
  const visible = Boolean(attachment);

  const restoreOrientationAndClose = useCallback(() => {
    void queueOrientationTransition(
      () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
    ).finally(onClose);
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    void queueOrientationTransition(() => ScreenOrientation.unlockAsync());
    return () => {
      void queueOrientationTransition(
        () => ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP),
      );
    };
  }, [visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={restoreOrientationAndClose}
      presentationStyle="overFullScreen"
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      transparent
      visible={visible}
    >
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaProvider>
          <StatusBar animated hidden />
          {attachment && (
            <ImagePreviewSurface
              attachment={attachment}
              canGoNext={index < attachments.length - 1}
              canGoPrevious={index > 0}
              count={attachments.length}
              index={index}
              key={attachment.id}
              onChangeIndex={(delta) => setIndex((current) => clamp(current + delta, 0, attachments.length - 1))}
              onClose={restoreOrientationAndClose}
            />
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ImagePreviewSurface({
  attachment,
  canGoNext,
  canGoPrevious,
  count,
  index,
  onChangeIndex,
  onClose,
}: {
  attachment: Attachment;
  canGoNext: boolean;
  canGoPrevious: boolean;
  count: number;
  index: number;
  onChangeIndex: (delta: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>(attachment.url ? 'loading' : 'error');
  const [retryKey, setRetryKey] = useState(0);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const chromeOpacity = useSharedValue(1);

  const position = useMemo(() => count > 1 ? `${index + 1} of ${count}` : 'Image preview', [count, index]);
  const imageSource = useMemo(() => attachment.url ? { uri: attachment.url } : null, [attachment.url]);

  const resetTransform = useCallback((animated = true) => {
    scale.value = animated ? withSpring(1, spring) : 1;
    translateX.value = animated ? withSpring(0, spring) : 0;
    translateY.value = animated ? withSpring(0, spring) : 0;
  }, [scale, translateX, translateY]);

  const setChrome = useCallback((visible: boolean) => {
    setChromeVisible(visible);
    chromeOpacity.value = withTiming(visible ? 1 : 0, { duration: 170 });
  }, [chromeOpacity]);

  const toggleChrome = useCallback(() => setChrome(!chromeVisible), [chromeVisible, setChrome]);

  const changeImage = useCallback((delta: number) => {
    onChangeIndex(delta);
  }, [onChangeIndex]);

  const close = useCallback(() => {
    resetTransform(false);
    onClose();
  }, [onClose, resetTransform]);

  const retry = useCallback(() => {
    setImageState('loading');
    setRetryKey((current) => current + 1);
  }, []);

  const viewportValue = useMemo(() => viewport, [viewport]);
  const imageValue = useMemo(() => imageSize, [imageSize]);

  const pinch = useMemo(() => Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const nextScale = clamp(startScale.value * event.scale, 1, IMAGE_VIEWER_MAX_SCALE);
      const next = zoomTranslationAtPoint({
        image: imageValue,
        viewport: viewportValue,
        fromScale: startScale.value,
        toScale: nextScale,
        currentX: startX.value,
        currentY: startY.value,
        focalX: event.focalX,
        focalY: event.focalY,
      });
      scale.value = nextScale;
      translateX.value = next.x;
      translateY.value = next.y;
    })
    .onEnd(() => {
      if (scale.value < 1.04) {
        scale.value = withSpring(1, spring);
        translateX.value = withSpring(0, spring);
        translateY.value = withSpring(0, spring);
      }
    }), [imageValue, scale, startScale, startX, startY, translateX, translateY, viewportValue]);

  const pan = useMemo(() => Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value > 1.01) {
        const next = clampImageTranslation({
          image: imageValue,
          viewport: viewportValue,
          scale: scale.value,
          x: startX.value + event.translationX,
          y: startY.value + event.translationY,
        });
        translateX.value = next.x;
        translateY.value = next.y;
        return;
      }

      const vertical = event.translationY > 0 && Math.abs(event.translationY) > Math.abs(event.translationX);
      translateX.value = vertical ? 0 : event.translationX;
      translateY.value = vertical ? event.translationY : 0;
    })
    .onEnd((event) => {
      if (scale.value > 1.01) {
        const next = clampImageTranslation({
          image: imageValue,
          viewport: viewportValue,
          scale: scale.value,
          x: translateX.value,
          y: translateY.value,
        });
        translateX.value = withSpring(next.x, spring);
        translateY.value = withSpring(next.y, spring);
        return;
      }

      const horizontalThreshold = Math.max(64, viewportValue.width * 0.16);
      const isHorizontal = Math.abs(translateX.value) > Math.abs(translateY.value);
      const wantsNext = isHorizontal && (translateX.value < -horizontalThreshold || event.velocityX < -750);
      const wantsPrevious = isHorizontal && (translateX.value > horizontalThreshold || event.velocityX > 750);
      if ((wantsNext && canGoNext) || (wantsPrevious && canGoPrevious)) {
        const delta = wantsNext ? 1 : -1;
        translateX.value = withTiming(wantsNext ? -viewportValue.width : viewportValue.width, { duration: 150 }, (finished) => {
          if (finished) runOnJS(changeImage)(delta);
        });
        return;
      }

      const dismissThreshold = Math.max(110, viewportValue.height * 0.14);
      if (translateY.value > dismissThreshold || event.velocityY > 900) {
        translateY.value = withTiming(viewportValue.height, { duration: 180 }, (finished) => {
          if (finished) runOnJS(close)();
        });
        return;
      }

      translateX.value = withSpring(0, spring);
      translateY.value = withSpring(0, spring);
    }), [
    canGoNext,
    canGoPrevious,
    changeImage,
    close,
    imageValue,
    scale,
    startX,
    startY,
    translateX,
    translateY,
    viewportValue,
  ]);

  const doubleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event, success) => {
      if (!success) return;
      if (scale.value > 1.05) {
        scale.value = withSpring(1, spring);
        translateX.value = withSpring(0, spring);
        translateY.value = withSpring(0, spring);
        return;
      }
      const next = zoomTranslationAtPoint({
        image: imageValue,
        viewport: viewportValue,
        fromScale: 1,
        toScale: IMAGE_VIEWER_DOUBLE_TAP_SCALE,
        currentX: 0,
        currentY: 0,
        focalX: event.x,
        focalY: event.y,
      });
      scale.value = withSpring(IMAGE_VIEWER_DOUBLE_TAP_SCALE, spring);
      translateX.value = withSpring(next.x, spring);
      translateY.value = withSpring(next.y, spring);
    }), [imageValue, scale, translateX, translateY, viewportValue]);

  const singleTap = useMemo(() => Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(240)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleChrome)();
    }), [toggleChrome]);

  const gestures = useMemo(
    () => Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap)),
    [doubleTap, pan, pinch, singleTap],
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(0.62, Math.max(0, translateY.value) / Math.max(1, viewportValue.height) * 0.72),
  }));

  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
  }, []);

  const zoomBy = useCallback((nextScale: number) => {
    const clampedScale = clamp(nextScale, 1, IMAGE_VIEWER_MAX_SCALE);
    const next = clampImageTranslation({
      image: imageSize,
      viewport,
      scale: clampedScale,
      x: translateX.value,
      y: translateY.value,
    });
    scale.value = withSpring(clampedScale, spring);
    translateX.value = withSpring(next.x, spring);
    translateY.value = withSpring(next.y, spring);
  }, [imageSize, scale, translateX, translateY, viewport]);

  return (
    <Animated.View style={[styles.safe, backdropStyle]}>
      <GestureDetector gesture={gestures}>
        <Animated.View
          accessible
          accessibilityActions={[
            { name: 'increment', label: 'Zoom in' },
            { name: 'decrement', label: 'Zoom out' },
            { name: 'activate', label: 'Reset zoom' },
          ]}
          accessibilityHint="Pinch or double tap to zoom. Swipe down to close."
          accessibilityLabel={`${attachment.filename}, ${position}`}
          accessibilityRole="image"
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') zoomBy(scale.value + 0.5);
            if (event.nativeEvent.actionName === 'decrement') zoomBy(scale.value - 0.5);
            if (event.nativeEvent.actionName === 'activate') resetTransform();
          }}
          onLayout={onLayout}
          style={styles.stage}
        >
          <Animated.View style={[styles.imageWrap, imageStyle]}>
            {imageSource && (
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={attachment.filename}
                key={`${attachment.id}-${retryKey}`}
                onError={() => setImageState('error')}
                onLoad={(event) => {
                  const { width, height } = event.nativeEvent.source;
                  setImageSize({ width, height });
                }}
                onLoadEnd={() => setImageState((current) => current === 'error' ? 'error' : 'ready')}
                resizeMode="contain"
                source={imageSource}
                style={styles.image}
              />
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      {imageState === 'loading' && (
        <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.feedback}>
          <ActivityIndicator color={palette.rubySoft} size="large" />
          <Text style={styles.feedbackCopy}>Preparing image…</Text>
        </View>
      )}

      {imageState === 'error' && (
        <View accessibilityLiveRegion="assertive" style={styles.feedback}>
          <Text style={styles.errorTitle}>Image couldn’t be loaded</Text>
          <Text style={styles.errorCopy}>Check your connection and try the attachment again.</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <RefreshCw color={palette.text} size={17} />
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      <Animated.View pointerEvents={chromeVisible ? 'box-none' : 'none'} style={[styles.chrome, chromeStyle]}>
        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <Pressable accessibilityLabel="Close image preview" accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <X color={palette.text} size={23} />
          </Pressable>
          <View pointerEvents="none" style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.filename}>{attachment.filename}</Text>
            <Text style={styles.position}>{position}</Text>
          </View>
          <Pressable
            accessibilityLabel="Share image"
            accessibilityRole="button"
            disabled={!attachment.url}
            onPress={() => attachment.url && void Share.share({ title: attachment.filename, url: attachment.url, message: attachment.url })}
            style={({ pressed }) => [styles.iconButton, !attachment.url && styles.disabled, pressed && styles.pressed]}
          >
            <Share2 color={palette.text} size={21} />
          </Pressable>
        </View>

        <View style={[styles.bottomBar, { bottom: insets.bottom + 10 }]}>
          {count > 1 && (
            <Pressable
              accessibilityLabel="Previous image"
              accessibilityRole="button"
              disabled={!canGoPrevious}
              onPress={() => changeImage(-1)}
              style={({ pressed }) => [styles.pageButton, !canGoPrevious && styles.disabled, pressed && styles.pressed]}
            >
              <ChevronLeft color={palette.text} size={21} />
            </Pressable>
          )}
          <View pointerEvents="none" style={styles.metadata}>
            <Text numberOfLines={1} style={styles.footerName}>{attachment.filename}</Text>
            <Text style={styles.footerMeta}>{formatFileSize(attachment.byte_size)} · Pinch to zoom</Text>
          </View>
          {count > 1 && (
            <Pressable
              accessibilityLabel="Next image"
              accessibilityRole="button"
              disabled={!canGoNext}
              onPress={() => changeImage(1)}
              style={({ pressed }) => [styles.pageButton, !canGoNext && styles.disabled, pressed && styles.pressed]}
            >
              <ChevronRight color={palette.text} size={21} />
            </Pressable>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#050609' },
  stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
  feedback: {
    position: 'absolute',
    top: '50%',
    left: 28,
    right: 28,
    transform: [{ translateY: -50 }],
    alignItems: 'center',
    gap: 9,
  },
  feedbackCopy: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 },
  errorTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, textAlign: 'center' },
  errorCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 280 },
  retry: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 18,
    marginTop: 4,
    backgroundColor: palette.ruby,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 },
  chrome: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,21,29,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(151,160,184,0.24)',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(10,12,17,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(151,160,184,0.18)',
  },
  filename: { color: palette.text, fontFamily: fonts.semibold, fontSize: 13, maxWidth: '100%' },
  position: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginTop: 2 },
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  metadata: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    paddingHorizontal: 17,
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(10,12,17,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(151,160,184,0.18)',
  },
  footerName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 },
  footerMeta: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginTop: 3 },
  pageButton: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,21,29,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(151,160,184,0.24)',
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  disabled: { opacity: 0.34 },
});
