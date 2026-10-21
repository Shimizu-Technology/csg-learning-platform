import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Bold, Code2, Italic, Link, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { AuthoredContent } from '@/components/authored-content';
import { fonts } from '@/constants/csg-theme';
import {
  normalizedRichTextValue,
  parseRichTextEditorMessage,
  richTextEditorCommandScript,
  richTextEditorContentScript,
  richTextEditorDocument,
  richTextEditorFontSize,
  richTextEditorThemeScript,
  safeRichTextLink,
  type RichTextEditorCommand,
  type RichTextEditorState,
} from '@/lib/rich-text-editor';

interface StaffRichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  placeholder?: string;
}

const MIN_EDITOR_HEIGHT = 220;
const MAX_EDITOR_HEIGHT = 440;
const EMPTY_STATE: RichTextEditorState = {
  bold: false,
  italic: false,
  link: false,
  blockquote: false,
  inlineCode: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  canUndo: false,
  canRedo: false,
};

export function StaffRichTextEditor({
  value,
  onChange,
  accessibilityLabel = 'Exercise instructions',
  placeholder = 'Explain the goal, constraints, and what done looks like…',
}: StaffRichTextEditorProps) {
  const styles = useStyles();
  const theme = useTheme();
  const { colors: c, scheme } = theme;
  const { fontScale } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);
  const lastEditorValueRef = useRef(normalizedRichTextValue(value));
  const [editorDocument, setEditorDocument] = useState(() => richTextEditorDocument(value, placeholder, fontScale, theme));
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(MIN_EDITOR_HEIGHT);
  const [selection, setSelection] = useState(EMPTY_STATE);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('https://');
  const [linkError, setLinkError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const normalizedValue = useMemo(() => normalizedRichTextValue(value), [value]);

  useEffect(() => {
    if (!ready || normalizedValue === lastEditorValueRef.current) return;
    lastEditorValueRef.current = normalizedValue;
    webViewRef.current?.injectJavaScript(richTextEditorContentScript(value));
  }, [normalizedValue, ready, value]);

  useEffect(() => {
    if (!ready) return;
    webViewRef.current?.injectJavaScript(richTextEditorCommandScript('setFontSize', String(richTextEditorFontSize(fontScale))));
  }, [fontScale, ready]);

  useEffect(() => {
    if (ready) webViewRef.current?.injectJavaScript(richTextEditorThemeScript(theme));
  }, [ready, theme]);

  const command = (name: RichTextEditorCommand, commandValue?: string) => {
    if (!ready) return;
    webViewRef.current?.injectJavaScript(richTextEditorCommandScript(name, commandValue));
  };

  const openLink = () => {
    setLinkValue('https://');
    setLinkError('');
    setLinkOpen(true);
    command('prepareLink');
  };

  const applyLink = () => {
    const safeLink = safeRichTextLink(linkValue);
    if (safeLink === null) {
      setLinkError('Use a full http, https, or mailto link.');
      return;
    }
    command('setLink', safeLink);
    setLinkOpen(false);
    setLinkError('');
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    const message = parseRichTextEditorMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready') setReady(true);
    if (message.type === 'height') setHeight(Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, message.height)));
    if (message.type === 'selection') setSelection(message.state);
    if (message.type === 'link') setLinkValue(message.href || 'https://');
    if (message.type === 'content') {
      lastEditorValueRef.current = message.html;
      onChange(message.html);
    }
  };

  const retryEditor = () => {
    const currentValue = normalizedRichTextValue(value);
    lastEditorValueRef.current = currentValue;
    setEditorDocument(richTextEditorDocument(value, placeholder, fontScale, theme));
    setReady(false);
    setLoadFailed(false);
  };

  if (loadFailed) {
    return <View style={styles.fallback}>
      <Text style={styles.fallbackTitle}>Formatting tools are unavailable</Text>
      <Text style={styles.fallbackCopy}>Your instructions are safe and unchanged. Review them below, then retry the editor before changing this field.</Text>
      <View style={styles.fallbackPreview}><AuthoredContent body={value} compact /></View>
      <Button accessibilityRole="button" onPress={retryEditor} style={styles.retryButton} variant="secondary" label="Retry formatting editor" textStyle={styles.retryButtonText} />
    </View>;
  }

  return <View style={styles.container}>
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
      <ToolbarButton label="Bold" active={selection.bold} disabled={!ready} icon={Bold} onPress={() => command('bold')} />
      <ToolbarButton label="Italic" active={selection.italic} disabled={!ready} icon={Italic} onPress={() => command('italic')} />
      <ToolbarButton label="Link" active={selection.link} disabled={!ready} icon={Link} onPress={openLink} />
      <ToolbarButton label="Quote" active={selection.blockquote} disabled={!ready} icon={Quote} onPress={() => command('blockquote')} />
      <ToolbarButton label="Inline code" active={selection.inlineCode} disabled={!ready} icon={Code2} onPress={() => command('inlineCode')} />
      <ToolbarButton label="Code block" active={selection.codeBlock} disabled={!ready} icon={Code2} onPress={() => command('codeBlock')} />
      <ToolbarButton label="Bullet list" active={selection.bulletList} disabled={!ready} icon={List} onPress={() => command('bulletList')} />
      <ToolbarButton label="Numbered list" active={selection.orderedList} disabled={!ready} icon={ListOrdered} onPress={() => command('orderedList')} />
      <View style={styles.divider} />
      <ToolbarButton label="Undo" disabled={!ready || !selection.canUndo} icon={Undo2} onPress={() => command('undo')} />
      <ToolbarButton label="Redo" disabled={!ready || !selection.canRedo} icon={Redo2} onPress={() => command('redo')} />
    </ScrollView>
    {linkOpen && <View style={styles.linkPanel}>
      <Text style={styles.linkLabel}>LINK URL</Text>
      <TextInput keyboardAppearance={scheme}
        accessibilityLabel="Instruction link URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={(next) => { setLinkValue(next); setLinkError(''); }}
        onSubmitEditing={applyLink}
        placeholder="https://…"
        placeholderTextColor={c.text.body}
        style={styles.linkInput}
        value={linkValue}
      />
      {linkError && <Text accessibilityRole="alert" style={styles.linkError}>{linkError}</Text>}
      <View style={styles.linkActions}>
        <Button accessibilityRole="button" onPress={() => { setLinkOpen(false); setLinkError(''); }} style={styles.linkButton} variant="quiet" label="Cancel" textStyle={styles.linkButtonText} />
        {selection.link && <Button accessibilityRole="button" onPress={() => { command('setLink', ''); setLinkOpen(false); }} style={styles.linkButton} variant="quiet" label="Remove link" textStyle={styles.linkButtonText} />}
        <Button accessibilityRole="button" onPress={applyLink} style={[styles.linkButton, styles.linkButtonPrimary]} variant="primary" label="Apply link" textStyle={styles.linkButtonPrimaryText} />
      </View>
    </View>}
    <WebView
      ref={webViewRef}
      accessibilityLabel={accessibilityLabel}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowsLinkPreview={false}
      bounces={false}
      javaScriptEnabled
      keyboardDisplayRequiresUserAction={false}
      mixedContentMode="never"
      onError={() => { setReady(false); setLoadFailed(true); }}
      onMessage={handleMessage}
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
      originWhitelist={['about:blank']}
      scrollEnabled={height >= MAX_EDITOR_HEIGHT}
      setSupportMultipleWindows={false}
      source={{ html: editorDocument, baseUrl: 'about:blank' }}
      style={[styles.editor, { height }]}
    />
    <Text style={styles.helper}>Write normally, paste formatted content, or select text and use the toolbar. Preview before saving to see the exact student view.</Text>
  </View>;
}

type IconComponent = typeof Bold;

function ToolbarButton({ label, active = false, disabled = false, icon: Icon, onPress }: { label: string; active?: boolean; disabled?: boolean; icon: IconComponent; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={[styles.tool, active && styles.toolActive, disabled && styles.toolDisabled]}>
    <Icon color={active ? c.text.body : c.text.body} size={18} />
    <Text style={[styles.toolText, active && styles.toolTextActive]}>{label}</Text>
  </Pressable>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised },
  toolbar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, backgroundColor: c.surface.sunken },
  toolbarContent: { minHeight: 58, alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 7 },
  tool: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolActive: { borderColor: c.border.strong, backgroundColor: c.surface.sunken },
  toolDisabled: { opacity: 0.35 },
  toolText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  toolTextActive: { color: c.text.body },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: c.border.subtle, marginHorizontal: 2 },
  editor: { width: '100%', backgroundColor: c.surface.raised },
  helper: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 13, paddingVertical: 10 },
  linkPanel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 12, gap: 8 },
  linkLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 },
  linkInput: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.raised, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 12 },
  linkError: { color: c.status.danger.fg, fontFamily: fonts.semibold, fontSize: 12 },
  linkActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7 },
  linkButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  linkButtonPrimary: { borderColor: c.action.primary, backgroundColor: c.action.primary },
  linkButtonText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  linkButtonPrimaryText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  fallback: { borderRadius: 16, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 13, gap: 7 },
  fallbackTitle: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 13 },
  fallbackCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  fallbackPreview: { minHeight: 100, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 12 },
  retryButton: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: c.border.strong, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryButtonText: { color: c.status.warning.fg, fontFamily: fonts.bold, fontSize: 12 },
}));
