import { AlertCircle, ExternalLink, RefreshCw } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { fonts, palette } from '@/constants/csg-theme';
import { openExternalPage } from '@/lib/external-links';
import { embeddedMediaHtml, isAllowedMediaNavigation, resolveMediaSource } from '@/lib/media-source';
import type { VideoProgressInput } from '@/lib/types';
import { NativeVideoPlayer } from './native-video-player';

interface InAppMediaPlayerProps {
  initialPosition?: number;
  initialTotalWatched?: number;
  saveProgress?: (progress: VideoProgressInput) => Promise<void>;
  title: string;
  trackProgress?: boolean;
  url: string;
}

export function InAppMediaPlayer({ initialPosition = 0, initialTotalWatched = 0, saveProgress, title, trackProgress = false, url }: InAppMediaPlayerProps) {
  const source = useMemo(() => resolveMediaSource(url), [url]);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const openOriginal = useCallback(() => void openExternalPage(source?.originalUrl).catch(() => undefined), [source?.originalUrl]);

  if (!source) return <UnsupportedMedia title={title} url={url} />;
  if (source.type === 'direct' && source.playbackUrl) {
    const playbackUrl = source.playbackUrl;
    return <View style={styles.stack}>
      <NativeVideoPlayer
        fetchStream={() => Promise.resolve({ stream_url: playbackUrl, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })}
        initialPosition={initialPosition || source.startSeconds}
        initialTotalWatched={initialTotalWatched}
        saveProgress={saveProgress || (() => Promise.resolve())}
        title={title}
        trackProgress={trackProgress && Boolean(saveProgress)}
      />
      <OriginalLink label="Open original video" onPress={openOriginal} />
    </View>;
  }
  if (source.type === 'external' || !source.playbackUrl) return <UnsupportedMedia title={title} url={source.originalUrl} />;
  const html = embeddedMediaHtml(source);

  return <View style={styles.shell}>
    <View style={styles.webWrap}>
      <WebView
        key={reloadKey}
        accessibilityLabel={`${title} ${source.providerLabel} player`}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        javaScriptEnabled
        mediaPlaybackRequiresUserAction
        onError={() => { setLoading(false); setError(true); }}
        onHttpError={() => { setLoading(false); setError(true); }}
        onLoadEnd={() => setLoading(false)}
        onLoadStart={() => { setLoading(true); setError(false); }}
        onShouldStartLoadWithRequest={(request) => isAllowedMediaNavigation(request.url)}
        originWhitelist={['https://*', 'about:blank']}
        source={{ html, baseUrl: 'https://learn.codeschoolofguam.com' }}
        style={styles.web}
      />
      {loading && <View pointerEvents="none" style={styles.overlay}><RefreshCw color={palette.rubySoft} size={24} /><Text style={styles.overlayText}>Loading {source.providerLabel}…</Text></View>}
      {error && <View style={styles.overlay}><AlertCircle color={palette.rubySoft} size={27} /><Text style={styles.errorTitle}>This video could not load here</Text><Text style={styles.errorCopy}>The host may have disabled embedded playback. You can retry or open the original.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry in-app playback" onPress={() => setReloadKey((value) => value + 1)} style={styles.retry}><RefreshCw color={palette.text} size={16} /><Text style={styles.retryText}>Retry</Text></Pressable></View>}
    </View>
    <View style={styles.footer}><View><Text style={styles.provider}>{source.providerLabel.toUpperCase()}</Text><Text style={styles.inline}>Plays securely inside the app</Text></View><OriginalLink label="Open original" onPress={openOriginal} /></View>
  </View>;
}

function UnsupportedMedia({ title, url }: { title: string; url: string }) {
  const source = resolveMediaSource(url);
  const validUrl = source?.originalUrl;
  return <View style={styles.unsupported}><AlertCircle color={palette.warning} size={24} /><View style={styles.unsupportedCopy}><Text style={styles.errorTitle}>In-app playback is not available</Text><Text style={styles.errorCopy}>{validUrl ? 'This host does not provide a supported embedded player yet.' : 'This video link is invalid or does not use a secure connection.'}</Text></View>{validUrl && <OriginalLink label={`Open ${title}`} onPress={() => void openExternalPage(validUrl).catch(() => undefined)} />}</View>;
}

function OriginalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={styles.original}><ExternalLink color={palette.rubySoft} size={15} /><Text style={styles.originalText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  shell: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised },
  webWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#030408' },
  web: { flex: 1, backgroundColor: '#030408' },
  overlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 22, backgroundColor: 'rgba(5,6,10,0.94)' },
  overlayText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11 },
  errorTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, textAlign: 'center' },
  errorCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  retry: { minHeight: 44, borderRadius: 13, backgroundColor: palette.ruby, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  retryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  footer: { minHeight: 58, paddingLeft: 13, paddingRight: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  provider: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  inline: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 2 },
  original: { minHeight: 44, borderRadius: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  originalText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
  unsupported: { minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: '#4A3A21', backgroundColor: '#211B12', padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8 },
  unsupportedCopy: { gap: 4 },
});
