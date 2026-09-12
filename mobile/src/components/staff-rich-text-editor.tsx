import { Bold, Code2, Italic, Link, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { AuthoredContent } from '@/components/authored-content';
import { fonts, palette } from '@/constants/csg-theme';
import {
  normalizedRichTextValue,
  parseRichTextEditorMessage,
  richTextEditorCommandScript,
  richTextEditorContentScript,
  richTextEditorDocument,
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
  const { fontScale } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);
  const lastEditorValueRef = useRef(normalizedRichTextValue(value));
  const [editorDocument, setEditorDocument] = useState(() => richTextEditorDocument(value, placeholder, fontScale));
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

  const command = (name: RichTextEditorCommand, commandValue?: string) => {
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
    setEditorDocument(richTextEditorDocument(value, placeholder, fontScale));
    setReady(false);
    setLoadFailed(false);
  };

  if (loadFailed) {
    return <View style={styles.fallback}>
      <Text style={styles.fallbackTitle}>Formatting tools are unavailable</Text>
      <Text style={styles.fallbackCopy}>Your instructions are safe and unchanged. Review them below, then retry the editor before changing this field.</Text>
      <View style={styles.fallbackPreview}><AuthoredContent body={value} compact /></View>
      <Pressable accessibilityRole="button" onPress={retryEditor} style={styles.retryButton}><Text style={styles.retryButtonText}>Retry formatting editor</Text></Pressable>
    </View>;
  }

  return <View style={styles.container}>
    <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={styles.toolbar} contentContainerStyle={styles.toolbarContent}>
      <ToolbarButton label="Bold" active={selection.bold} icon={Bold} onPress={() => command('bold')} />
      <ToolbarButton label="Italic" active={selection.italic} icon={Italic} onPress={() => command('italic')} />
      <ToolbarButton label="Link" active={selection.link} icon={Link} onPress={openLink} />
      <ToolbarButton label="Quote" active={selection.blockquote} icon={Quote} onPress={() => command('blockquote')} />
      <ToolbarButton label="Inline code" active={selection.inlineCode} icon={Code2} onPress={() => command('inlineCode')} />
      <ToolbarButton label="Code block" active={selection.codeBlock} icon={Code2} onPress={() => command('codeBlock')} />
      <ToolbarButton label="Bullet list" active={selection.bulletList} icon={List} onPress={() => command('bulletList')} />
      <ToolbarButton label="Numbered list" active={selection.orderedList} icon={ListOrdered} onPress={() => command('orderedList')} />
      <View style={styles.divider} />
      <ToolbarButton label="Undo" disabled={!selection.canUndo} icon={Undo2} onPress={() => command('undo')} />
      <ToolbarButton label="Redo" disabled={!selection.canRedo} icon={Redo2} onPress={() => command('redo')} />
    </ScrollView>
    {linkOpen && <View style={styles.linkPanel}>
      <Text style={styles.linkLabel}>LINK URL</Text>
      <TextInput
        accessibilityLabel="Instruction link URL"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={(next) => { setLinkValue(next); setLinkError(''); }}
        onSubmitEditing={applyLink}
        placeholder="https://…"
        placeholderTextColor={palette.quiet}
        style={styles.linkInput}
        value={linkValue}
      />
      {linkError && <Text accessibilityRole="alert" style={styles.linkError}>{linkError}</Text>}
      <View style={styles.linkActions}>
        <Pressable accessibilityRole="button" onPress={() => { setLinkOpen(false); setLinkError(''); }} style={styles.linkButton}><Text style={styles.linkButtonText}>Cancel</Text></Pressable>
        {selection.link && <Pressable accessibilityRole="button" onPress={() => { command('setLink', ''); setLinkOpen(false); }} style={styles.linkButton}><Text style={styles.linkButtonText}>Remove link</Text></Pressable>}
        <Pressable accessibilityRole="button" onPress={applyLink} style={[styles.linkButton, styles.linkButtonPrimary]}><Text style={styles.linkButtonPrimaryText}>Apply link</Text></Pressable>
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
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={[styles.tool, active && styles.toolActive, disabled && styles.toolDisabled]}>
    <Icon color={active ? palette.rubySoft : palette.muted} size={18} />
    <Text style={[styles.toolText, active && styles.toolTextActive]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel },
  toolbar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.panelRaised },
  toolbarContent: { minHeight: 58, alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 7 },
  tool: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolActive: { borderColor: '#6A2A36', backgroundColor: '#351821' },
  toolDisabled: { opacity: 0.35 },
  toolText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  toolTextActive: { color: palette.rubySoft },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: palette.line, marginHorizontal: 2 },
  editor: { width: '100%', backgroundColor: palette.panel },
  helper: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, paddingHorizontal: 13, paddingVertical: 10 },
  linkPanel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: '#211319', padding: 12, gap: 8 },
  linkLabel: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  linkInput: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#4D2630', backgroundColor: palette.panel, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 12 },
  linkError: { color: palette.rubySoft, fontFamily: fonts.semibold, fontSize: 11 },
  linkActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 7 },
  linkButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  linkButtonPrimary: { borderColor: palette.ruby, backgroundColor: palette.ruby },
  linkButtonText: { color: palette.muted, fontFamily: fonts.bold, fontSize: 11 },
  linkButtonPrimaryText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  fallback: { borderRadius: 16, borderWidth: 1, borderColor: '#5A4520', backgroundColor: '#282013', padding: 13, gap: 7 },
  fallbackTitle: { color: palette.warning, fontFamily: fonts.bold, fontSize: 13 },
  fallbackCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  fallbackPreview: { minHeight: 100, borderRadius: 13, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 12 },
  retryButton: { minHeight: 44, alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, borderColor: '#6B5425', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  retryButtonText: { color: palette.warning, fontFamily: fonts.bold, fontSize: 11 },
});
