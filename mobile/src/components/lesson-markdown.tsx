import { useMemo } from 'react';
import { Alert, useWindowDimensions } from 'react-native';
import RenderHtml from 'react-native-render-html';

import { fonts, palette } from '@/constants/csg-theme';
import { openExternalPage } from '@/lib/external-links';
import { renderLessonMarkdown } from '@/lib/lesson-markdown';

interface LessonMarkdownProps {
  body: string;
}

export function LessonMarkdown({ body }: LessonMarkdownProps) {
  const { width } = useWindowDimensions();
  const html = useMemo(() => renderLessonMarkdown(body), [body]);

  return (
    <RenderHtml
      contentWidth={Math.max(240, width - 72)}
      source={{ html }}
      ignoredDomTags={['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button']}
      renderersProps={{ a: { onPress: (_event, href) => { void openExternalPage(href).catch((error) => Alert.alert('Could not open link', (error as Error).message)); } } }}
      baseStyle={{ color: palette.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 23 }}
      tagsStyles={{
        h1: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 24, lineHeight: 31, marginTop: 18, marginBottom: 8 },
        h2: { color: palette.text, fontFamily: fonts.bold, fontSize: 20, lineHeight: 27, marginTop: 17, marginBottom: 7 },
        h3: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, marginTop: 15, marginBottom: 6 },
        p: { marginTop: 0, marginBottom: 12 },
        strong: { color: palette.text, fontFamily: fonts.bold },
        em: { color: '#D6D9E1' },
        a: { color: palette.rubySoft, textDecorationLine: 'underline' },
        ul: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        ol: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        li: { marginBottom: 5 },
        blockquote: { borderLeftWidth: 3, borderLeftColor: palette.ruby, backgroundColor: '#211319', paddingHorizontal: 13, paddingVertical: 10, marginVertical: 10 },
        pre: { backgroundColor: '#080A0E', borderWidth: 1, borderColor: palette.line, borderRadius: 12, color: '#E5E7EB', padding: 13, marginVertical: 10 },
        code: { color: '#F5A3AF', fontFamily: 'Menlo', fontSize: 12, backgroundColor: '#20151A' },
        img: { borderRadius: 12, marginVertical: 8 },
      }}
    />
  );
}
