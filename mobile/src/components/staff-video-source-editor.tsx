import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { CheckCircle2, Film, Link2, ShieldCheck, UploadCloud, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, palette } from '@/constants/csg-theme';
import { MAX_VIDEO_SIZE, type VideoUploadAsset } from '@/lib/video-upload';

export interface StaffVideoSourceValue {
  video_url: string;
  s3_video_key: string | null;
  s3_video_content_type: string | null;
  s3_video_size: number | null;
}

interface StaffVideoSourceEditorProps {
  value: StaffVideoSourceValue;
  persistedS3Key: string | null;
  uploadedAt?: string | null;
  uploadedBy?: string | null;
  onChange: (patch: Partial<StaffVideoSourceValue>) => void;
  onUpload: (asset: VideoUploadAsset, onProgress: (percent: number, label: string) => void) => Promise<{ s3_video_key: string; s3_video_content_type: string; s3_video_size: number }>;
  onAbandon: (s3Key: string) => Promise<void>;
  onCleanupDeferred?: (s3Key: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

const supportedVideoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/m4v']);

function supportedMime(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && supportedVideoMimeTypes.has(normalized) ? normalized : null;
}

function fallbackMime(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'webm') return 'video/webm';
  if (extension === 'm4v') return 'video/x-m4v';
  return null;
}

function storedFileName(key: string | null) {
  const name = key?.split('/').pop();
  return name?.replace(/^\d{13,14}_(?:[0-9a-f]{8}_)?/, '') || null;
}

function readableSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes < 1024 ** 2) return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function StaffVideoSourceEditor({ value, persistedS3Key, uploadedAt, uploadedBy, onChange, onUpload, onAbandon, onCleanupDeferred, onBusyChange }: StaffVideoSourceEditorProps) {
  const [preferredMode, setPreferredMode] = useState<'link' | 'upload'>(() => value.s3_video_key ? 'upload' : 'link');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready to upload');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const activeSource = value.s3_video_key ? 'upload' : value.video_url.trim() ? 'link' : null;
  const mode = activeSource || preferredMode;
  const staged = Boolean(value.s3_video_key && value.s3_video_key !== persistedS3Key);
  const fileName = selectedName || storedFileName(value.s3_video_key) || 'Hosted lesson video';
  const fileSize = readableSize(value.s3_video_size);
  const uploadMeta = useMemo(() => {
    if (staged) return 'Uploaded and ready to save with this lesson.';
    if (!uploadedAt && !uploadedBy) return 'Stored securely by Code School.';
    const date = uploadedAt ? new Date(uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    return [date ? `Uploaded ${date}` : null, uploadedBy ? `by ${uploadedBy}` : null].filter(Boolean).join(' ');
  }, [staged, uploadedAt, uploadedBy]);

  useEffect(() => { onBusyChange?.(uploading); }, [onBusyChange, uploading]);

  const clearUpload = async () => {
    const key = value.s3_video_key;
    if (key && key !== persistedS3Key) {
      try { await onAbandon(key); }
      catch (error) { Alert.alert('Could not remove upload', (error as Error).message); return false; }
    }
    setSelectedName(null);
    setProgress(0);
    setStatus('Ready to upload');
    onChange({ s3_video_key: null, s3_video_content_type: null, s3_video_size: null });
    return true;
  };

  const selectMode = async (next: 'link' | 'upload') => {
    if (uploading || next === mode) return;
    if (next === 'link' && value.s3_video_key && !(await clearUpload())) return;
    if (next === 'upload' && value.video_url.trim()) onChange({ video_url: '' });
    setPreferredMode(next);
  };

  const uploadPickedVideo = async (picked: { uri: string; name?: string | null; size?: number | null; mimeType?: string | null }) => {
    if (uploading) return;
    const file = new File(picked.uri);
    const name = picked.name || `lesson-video-${Date.now()}.mp4`;
    const mimeType = supportedMime(picked.mimeType) || supportedMime(file.type) || fallbackMime(name);
    if (!mimeType) { Alert.alert('Choose a supported video', 'Use an MP4, MOV, M4V, or WebM video.'); return; }
    const asset: VideoUploadAsset = {
      uri: picked.uri,
      name,
      size: picked.size ?? file.size,
      mimeType,
    };
    if (!asset.size || asset.size <= 0) { Alert.alert('Could not read video', 'Choose the video again from Files or Photos.'); return; }
    if (asset.size > MAX_VIDEO_SIZE) { Alert.alert('Video is too large', 'Lesson videos must be 5 GB or smaller.'); return; }
    setUploading(true);
    setSelectedName(asset.name);
    setProgress(0);
    try {
      const uploaded = await onUpload(asset, (nextProgress, nextStatus) => { setProgress(nextProgress); setStatus(nextStatus); });
      const previousOrphan = value.s3_video_key && value.s3_video_key !== persistedS3Key ? value.s3_video_key : null;
      if (previousOrphan && previousOrphan !== uploaded.s3_video_key) {
        try { await onAbandon(previousOrphan); }
        catch (cleanupError) {
          try { await onAbandon(uploaded.s3_video_key); }
          catch {
            if (onCleanupDeferred) await onCleanupDeferred(uploaded.s3_video_key);
          }
          throw new Error((cleanupError as Error).message || 'The previous staged video could not be removed. Try replacing it again.');
        }
      }
      onChange({ ...uploaded, video_url: '' });
      setProgress(100);
      setStatus('Ready to save with lesson');
    } catch (error) {
      setSelectedName(null);
      setProgress(0);
      setStatus('Upload failed');
      Alert.alert('Video change did not finish', (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const pickFromFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: true, multiple: false });
    if (!result.canceled) await uploadPickedVideo(result.assets[0]);
  };

  const pickFromPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false });
    if (!result.canceled) {
      const picked = result.assets[0];
      await uploadPickedVideo({ uri: picked.uri, name: picked.fileName, size: picked.fileSize, mimeType: picked.mimeType });
    }
  };

  return <View style={styles.wrap}>
    <View style={styles.modeRow}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'link' }} disabled={uploading} onPress={() => void selectMode('link')} style={[styles.mode, mode === 'link' && styles.modeActive]}><Link2 color={mode === 'link' ? palette.rubySoft : palette.muted} size={16} /><Text style={[styles.modeText, mode === 'link' && styles.modeTextActive]}>Use link</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'upload' }} disabled={uploading} onPress={() => void selectMode('upload')} style={[styles.mode, mode === 'upload' && styles.modeActive]}><UploadCloud color={mode === 'upload' ? palette.rubySoft : palette.muted} size={16} /><Text style={[styles.modeText, mode === 'upload' && styles.modeTextActive]}>Upload file</Text></Pressable>
    </View>

    <View style={styles.current}><View style={[styles.currentIcon, activeSource === 'upload' && styles.currentIconUpload]}>{activeSource === 'upload' ? <Film color={palette.rubySoft} size={18} /> : activeSource === 'link' ? <Link2 color={palette.rubySoft} size={18} /> : <ShieldCheck color={palette.quiet} size={18} />}</View><View style={styles.flex}><Text style={styles.currentLabel}>CURRENT SOURCE</Text><Text style={styles.currentTitle}>{activeSource === 'upload' ? 'Self-hosted video' : activeSource === 'link' ? 'Video link' : 'No video attached'}</Text></View>{activeSource && <CheckCircle2 color={palette.success} size={18} />}</View>

    {mode === 'link' ? <View style={styles.field}><Text style={styles.label}>VIDEO LINK</Text><TextInput accessibilityLabel="Video link" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={value.video_url} onChangeText={(video_url) => onChange({ video_url })} placeholder="https://youtube.com/watch?v=…" placeholderTextColor={palette.quiet} style={styles.input} /><Text style={styles.help}>Paste a YouTube URL or another secure video link.</Text></View> : <View style={styles.uploadPanel}>
      {value.s3_video_key ? <View style={styles.fileCard}><View style={styles.fileIcon}><Film color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text numberOfLines={2} style={styles.fileName}>{fileName}</Text><Text style={styles.fileMeta}>{[fileSize, uploadMeta].filter(Boolean).join(' · ')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Remove hosted video" disabled={uploading} onPress={() => void clearUpload()} style={styles.remove}><X color={palette.muted} size={18} /></Pressable></View> : <View style={styles.picker}><UploadCloud color={palette.rubySoft} size={27} /><Text style={styles.pickerTitle}>{uploading ? 'Uploading lesson video…' : 'Choose a lesson video'}</Text><Text style={styles.pickerCopy}>MP4, MOV, M4V, or WebM · up to 5 GB</Text></View>}
      {(uploading || progress > 0) && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.progress}><View style={styles.progressTop}><Text style={styles.progressText}>{status}</Text><Text style={styles.progressPercent}>{progress}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View></View>}
      {!uploading && <View style={styles.sourceActions}><Pressable accessibilityRole="button" accessibilityLabel={value.s3_video_key ? 'Replace hosted video from photos' : 'Choose lesson video from photos'} onPress={() => void pickFromPhotos()} style={styles.replace}><Film color={palette.rubySoft} size={17} /><Text style={styles.replaceText}>Photos</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={value.s3_video_key ? 'Replace hosted video from files' : 'Choose lesson video from files'} onPress={() => void pickFromFiles()} style={styles.replace}><UploadCloud color={palette.rubySoft} size={17} /><Text style={styles.replaceText}>Browse files</Text></Pressable></View>}
      <Text style={styles.help}>Large files upload in retryable parts. Keep this screen open until the file is ready to save.</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 }, flex: { flex: 1, minWidth: 0 }, modeRow: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 4, flexDirection: 'row', gap: 4 }, mode: { flex: 1, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, modeActive: { backgroundColor: '#351821' }, modeText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 }, modeTextActive: { color: palette.rubySoft }, current: { minHeight: 66, borderRadius: 17, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, currentIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center' }, currentIconUpload: { backgroundColor: '#2A151B' }, currentLabel: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, currentTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, marginTop: 3 }, field: { gap: 7 }, label: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 }, input: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 13, paddingVertical: 12 }, help: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 }, uploadPanel: { gap: 10 }, picker: { minHeight: 112, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#62303C', backgroundColor: '#1D1217', alignItems: 'center', justifyContent: 'center', padding: 18 }, pickerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 13, marginTop: 9 }, pickerCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 5 }, fileCard: { minHeight: 78, borderRadius: 17, borderWidth: 1, borderColor: '#28523C', backgroundColor: '#15271E', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, fileIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#203B2D', alignItems: 'center', justifyContent: 'center' }, fileName: { color: palette.text, fontFamily: fonts.bold, fontSize: 12 }, fileMeta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, progress: { borderRadius: 15, borderWidth: 1, borderColor: '#62303C', backgroundColor: '#211319', padding: 12 }, progressTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, progressText: { flex: 1, color: palette.text, fontFamily: fonts.semibold, fontSize: 11 }, progressPercent: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, track: { height: 6, borderRadius: 3, backgroundColor: '#3A232B', overflow: 'hidden', marginTop: 9 }, fill: { height: '100%', borderRadius: 3, backgroundColor: palette.rubySoft }, sourceActions: { flexDirection: 'row', gap: 8 }, replace: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, replaceText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
});
