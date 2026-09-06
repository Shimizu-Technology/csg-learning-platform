import { useMemo } from 'react';
import { Alert, useWindowDimensions } from 'react-native';
import RenderHtml from 'react-native-render-html';

import { fonts, palette } from '@/constants/csg-theme';
import { authoredContentSource } from '@/lib/authored-content';
import { openExternalPage } from '@/lib/external-links';

interface AuthoredContentProps {
  body: string;
  compact?: boolean;
}

const UNSUPPORTED_OR_UNSAFE_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'link', 'meta', 'base', 'canvas', 'svg',
  'video', 'audio', 'source',
];

/**
 * Renders the two formats used by CSG course content: legacy Markdown and the
 * semantic HTML emitted by the web rich-text editor. Native HTML is converted
 * to React Native views rather than injected into a browser DOM; scripting,
 * forms, embedded content, inline CSS, and unsafe link protocols stay disabled.
 */
export function AuthoredContent({ body, compact = false }: AuthoredContentProps) {
  const { width } = useWindowDimensions();
  const source = useMemo(() => authoredContentSource(body), [body]);
  const bodySize = compact ? 14 : 15;
  const bodyLineHeight = compact ? 22 : 24;

  return (
    <RenderHtml
      contentWidth={Math.max(240, width - 72)}
      source={{ html: source.html }}
      ignoredDomTags={UNSUPPORTED_OR_UNSAFE_TAGS}
      enableCSSInlineProcessing={false}
      renderersProps={{
        a: {
          onPress: (_event, href) => {
            void openExternalPage(href).catch((error) => Alert.alert('Could not open link', (error as Error).message));
          },
        },
      }}
      baseStyle={{ color: palette.muted, fontFamily: fonts.regular, fontSize: bodySize, lineHeight: bodyLineHeight }}
      tagsStyles={{
        h1: { color: palette.text, fontFamily: fonts.extraBold, fontSize: compact ? 22 : 24, lineHeight: compact ? 29 : 31, marginTop: 18, marginBottom: 8 },
        h2: { color: palette.text, fontFamily: fonts.bold, fontSize: compact ? 19 : 20, lineHeight: compact ? 26 : 27, marginTop: 17, marginBottom: 7 },
        h3: { color: palette.text, fontFamily: fonts.bold, fontSize: compact ? 16 : 17, lineHeight: compact ? 23 : 24, marginTop: 15, marginBottom: 6 },
        p: { marginTop: 0, marginBottom: 12 },
        strong: { color: palette.text, fontFamily: fonts.bold },
        b: { color: palette.text, fontFamily: fonts.bold },
        em: { color: '#D6D9E1' },
        i: { color: '#D6D9E1' },
        a: { color: palette.rubySoft, textDecorationLine: 'underline' },
        ul: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        ol: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        li: { marginBottom: 6 },
        blockquote: { borderLeftWidth: 3, borderLeftColor: palette.ruby, backgroundColor: '#211319', paddingHorizontal: 13, paddingVertical: 10, marginVertical: 10 },
        pre: { backgroundColor: '#080A0E', borderWidth: 1, borderColor: palette.line, borderRadius: 12, color: '#E5E7EB', padding: 13, marginVertical: 10 },
        code: { color: '#F5A3AF', fontFamily: 'Menlo', fontSize: 13, backgroundColor: '#20151A' },
        img: { borderRadius: 12, marginVertical: 8 },
        table: { borderWidth: 1, borderColor: palette.line, marginVertical: 10 },
        th: { color: palette.text, fontFamily: fonts.bold, backgroundColor: palette.panelRaised, padding: 8 },
        td: { color: palette.muted, padding: 8, borderTopWidth: 1, borderColor: palette.line },
      }}
    />
  );
}
