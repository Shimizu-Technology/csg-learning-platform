import { themedAlert as Alert } from '@/lib/alerts';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Code2, ExternalLink } from 'lucide-react-native';
import { useMemo } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import RenderHtml, { defaultSystemFonts, HTMLContentModel, HTMLElementModel, isDomElement, type CustomBlockRenderer, type TNode } from 'react-native-render-html';

import { fonts, monoFont } from '@/constants/csg-theme';
import { authoredContentSource, CODE_TAG, extractCodeBlocks, markStarterLinks, STARTER_TAG } from '@/lib/authored-content';
import { openExternalPage } from '@/lib/external-links';
import { DEFAULT_STARTER_LABEL, isHafaStarterLink, STARTER_HINTS, withLessonReturn, type LessonReturn, type StarterHint } from '@/lib/hafa-starter-links';
import { safeExternalUrl } from '@/lib/learning';
import { MessageCodeBlock } from './message-code-block';

/** Where a Hafa Code starter renders: its return target and the hint under the button. */
export interface StarterLinkContext {
  lessonReturn: LessonReturn;
  hint: StarterHint;
}

interface AuthoredContentProps {
  body: string;
  compact?: boolean;
  /** Lesson context for Hafa Code starter links; omit outside a lesson. */
  starterLinks?: StarterLinkContext;
}

const UNSUPPORTED_OR_UNSAFE_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'link', 'meta', 'base', 'canvas', 'svg',
  'video', 'audio', 'source',
];

/** Extracts preformatted text without trusting or re-parsing the source HTML. */
export function authoredPlainText(node: TNode): string {
  if (node.type === 'text') return (node as TNode & { data: string }).data;
  return node.children.map(authoredPlainText).join('');
}

const STARTER_MODEL = HTMLElementModel.fromCustomModel({ tagName: STARTER_TAG, contentModel: HTMLContentModel.block });
const CODE_MODEL = HTMLElementModel.fromCustomModel({ tagName: CODE_TAG, contentModel: HTMLContentModel.block });

function starterLabel(tnode: TNode, href: string) {
  const text = authoredPlainText(tnode).trim();
  return !text || text === href ? DEFAULT_STARTER_LABEL : text;
}

function openLink(href: string, starterLinks?: StarterLinkContext) {
  const target = starterLinks && isHafaStarterLink(href) ? withLessonReturn(href, starterLinks.lessonReturn) : href;
  void openExternalPage(target).catch((error) => Alert.alert('Could not open link', (error as Error).message));
}

const AUTHORED_SYSTEM_FONTS = [...new Set([
  ...defaultSystemFonts,
  fonts.regular,
  fonts.bold,
  fonts.extraBold,
  monoFont,
])];
const CUSTOM_MODELS = { [STARTER_TAG]: STARTER_MODEL, [CODE_TAG]: CODE_MODEL };

/**
 * Renders the two formats used by CSG course content: legacy Markdown and the
 * semantic HTML emitted by the web rich-text editor. Native HTML is converted
 * to React Native views rather than injected into a browser DOM; scripting,
 * forms, embedded content, inline CSS, and unsafe link protocols stay disabled.
 */
export function AuthoredContent({ body, compact = false, starterLinks }: AuthoredContentProps) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  // Code blocks leave the HTML before rendering so their exact text survives (see extractCodeBlocks).
  const { html, codeBlocks } = useMemo(() => {
    const extracted = extractCodeBlocks(authoredContentSource(body).html);
    return { html: markStarterLinks(extracted.html, isHafaStarterLink), codeBlocks: extracted.blocks };
  }, [body]);
  const bodySize = compact ? 14 : 17;
  const bodyLineHeight = compact ? 22 : 27;
  const renderers = useMemo(() => {
    const StarterLink: CustomBlockRenderer = ({ tnode }) => {
      const href = tnode.attributes.href || '';
      if (!isHafaStarterLink(href)) return null;
      const label = starterLabel(tnode, href);
      const hint = STARTER_HINTS[starterLinks?.hint || 'practice'];
      return <View style={styles.starter} testID="hafa-starter">
        <Button variant="primary" accessibilityRole="link" accessibilityLabel={label} accessibilityHint={`Opens Hafa Code in a browser sheet. ${hint}`} onPress={() => openLink(href, starterLinks)} style={({ pressed }) => [styles.starterButton, pressed && styles.pressed]}>
          <Code2 color={c.text.onAction} size={18} />
          <Text style={styles.starterLabel}>{label}</Text>
          <ExternalLink color={c.text.onAction} size={16} />
        </Button>
        <Text style={styles.starterHint}>{hint}</Text>
      </View>;
    };
    const AuthoredCode: CustomBlockRenderer = ({ tnode }) => {
      const block = codeBlocks[Number(tnode.attributes['data-index'])];
      if (!block) return null;
      return <View style={styles.codeBlock}><MessageCodeBlock code={block.code} language={block.language} surface="lesson" testID="authored-code-block" /></View>;
    };
    return { [CODE_TAG]: AuthoredCode, [STARTER_TAG]: StarterLink };
  }, [c, codeBlocks, starterLinks, styles]);

  return (
    <RenderHtml
      contentWidth={Math.max(240, width - 72)}
      source={{ html }}
      customHTMLElementModels={CUSTOM_MODELS}
      ignoredDomTags={UNSUPPORTED_OR_UNSAFE_TAGS}
      ignoreDomNode={(node) => isDomElement(node) && node.name === 'img' && !safeExternalUrl(node.attribs.src)}
      enableCSSInlineProcessing={false}
      renderers={renderers}
      systemFonts={AUTHORED_SYSTEM_FONTS}
      renderersProps={{
        a: { onPress: (_event, href) => openLink(href, starterLinks) },
      }}
      baseStyle={{ color: c.text.body, fontFamily: fonts.regular, fontSize: bodySize, lineHeight: bodyLineHeight }}
      tagsStyles={{
        h1: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: compact ? 22 : 24, lineHeight: compact ? 29 : 31, marginTop: 18, marginBottom: 8 },
        h2: { color: c.text.strong, fontFamily: fonts.bold, fontSize: compact ? 19 : 20, lineHeight: compact ? 26 : 27, marginTop: 17, marginBottom: 7 },
        h3: { color: c.text.strong, fontFamily: fonts.bold, fontSize: compact ? 16 : 17, lineHeight: compact ? 23 : 24, marginTop: 15, marginBottom: 6 },
        p: { marginTop: 0, marginBottom: 12 },
        strong: { color: c.text.strong, fontFamily: fonts.bold },
        b: { color: c.text.strong, fontFamily: fonts.bold },
        em: { color: c.text.body },
        i: { color: c.text.body },
        a: { color: c.text.body, textDecorationLine: 'underline' },
        ul: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        ol: { marginTop: 0, marginBottom: 12, paddingLeft: 18 },
        li: { marginBottom: 6 },
        blockquote: { borderLeftWidth: 3, borderLeftColor: c.action.primary, backgroundColor: c.surface.sunken, paddingHorizontal: 13, paddingVertical: 10, marginVertical: 10 },
        code: { color: c.text.strong, fontFamily: monoFont, fontSize: 13, backgroundColor: c.surface.sunken },
        img: { borderRadius: 12, marginVertical: 8 },
        table: { borderWidth: 1, borderColor: c.border.subtle, marginVertical: 10 },
        th: { color: c.text.strong, fontFamily: fonts.bold, backgroundColor: c.surface.sunken, padding: 8 },
        td: { color: c.text.body, padding: 8, borderTopWidth: 1, borderColor: c.border.subtle },
      }}
    />
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  codeBlock: { marginVertical: 10 },
  starter: { marginTop: 2, marginBottom: 14, gap: 7, alignItems: 'flex-start' },
  starterButton: { minHeight: 48, maxWidth: '100%', borderRadius: 14,  paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  starterLabel: { flexShrink: 1, color: c.text.onAction, fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  starterHint: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
}));
