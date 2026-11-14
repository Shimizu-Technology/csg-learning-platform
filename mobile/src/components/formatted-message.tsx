import { makeStyles } from '@/providers/theme-provider';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { MessageCodeBlock } from '@/components/message-code-block';
import { fontScaleLimits, fonts, typography, monoFont } from '@/constants/csg-theme';
import { messageSegments } from '@/lib/mentions';
import { normalizeMessageLink, parseInline, parseMessageBlocks } from '@/lib/message-format';
import type { InlineNode, MessageListBlock } from '@/lib/message-format';
import type { UserSummary } from '@/lib/types';

type Props = {
  body: string;
  mentionUsers: UserSummary[];
  mine?: boolean;
};

export function FormattedMessage({ body, mentionUsers, mine = false }: Props) {
  const styles = useStyles();
  const blocks = useMemo(() => parseMessageBlocks(body), [body]);

  if (!body) return null;

  return (
    <View style={styles.content}>
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`;
        if (block.type === 'spacer') return <View key={key} style={styles.spacer} />;

        if (block.type === 'code') {
          return <MessageCodeBlock code={block.code} key={key} language={block.language} />;
        }

        if (block.type === 'bulletList' || block.type === 'orderedList') {
          return renderList(block, key);
        }

        if (block.type === 'heading') {
          return <Text key={key} accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, styles.heading, block.level === 3 && styles.subheading, mine && styles.mineText]}>{formatInline(block.text, key)}</Text>;
        }

        if (block.type === 'blockquote') {
          return (
            <View key={key} style={[styles.blockquote, mine && styles.mineBlockquote]}>
              <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, styles.quoteText, mine && styles.mineText]}>{formatInline(block.text, key)}</Text>
            </View>
          );
        }

        return <Text key={key} maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(block.text, key)}</Text>;
      })}
    </View>
  );

function renderList(block: MessageListBlock, key: string, depth = 0): ReactNode {
  const bullet = ['•', '◦', '▪'][depth % 3];
  const start = block.type === 'orderedList' ? block.start ?? 1 : 1;
  return (
    <View key={key} style={styles.list}>
      {block.items.map((item, index) => {
        const itemKey = `${key}-${index}`;
        return (
          <View key={itemKey} style={styles.listRow}>
            <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.listMarker, mine && styles.mineText]}>{block.type === 'bulletList' ? bullet : `${start + index}.`}</Text>
            <View style={styles.listItem}>
              <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(item.text, itemKey)}</Text>
              {item.children.map((child, childIndex) => {
                const childKey = `${itemKey}-child-${childIndex}`;
                if (child.type === 'bulletList' || child.type === 'orderedList') return renderList(child, childKey, depth + 1);
                if (child.type === 'code') return <MessageCodeBlock code={child.code} key={childKey} language={child.language} />;
                if (child.type === 'blockquote') return (
                  <View key={childKey} style={[styles.blockquote, mine && styles.mineBlockquote]}>
                    <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, styles.quoteText, mine && styles.mineText]}>{formatInline(child.text, childKey)}</Text>
                  </View>
                );
                return <Text key={childKey} maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(child.text, childKey)}</Text>;
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatInline(text: string, keyPrefix: string): ReactNode[] {
  return renderInline(parseInline(text), keyPrefix, false);
}

/** Inline code keeps the marks around it: bold code is bold, italic code is italic. */
function renderInline(nodes: InlineNode[], keyPrefix: string, strong: boolean, emphasis = false): ReactNode[] {
  return nodes.flatMap((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return renderMentions(node.text, mentionUsers, key);
      case 'code':
        return [<Text key={key} style={[styles.inlineCode, mine && styles.mineInlineCode, strong && styles.boldCode, emphasis && styles.italic]}>{node.text}</Text>];
      case 'strong':
        return [<Text key={key} style={styles.bold}>{renderInline(node.children, key, true, emphasis)}</Text>];
      case 'emphasis':
        return [<Text key={key} style={styles.italic}>{renderInline(node.children, key, strong, true)}</Text>];
      case 'strike':
        return [<Text key={key} style={styles.strike}>{renderInline(node.children, key, strong, emphasis)}</Text>];
      case 'underline':
        return [<Text key={key} style={styles.underline}>{renderInline(node.children, key, strong, emphasis)}</Text>];
      case 'link':
        return [renderLink(renderInline(node.children, key, strong, emphasis), node.href, key)];
    }
  });
}

function renderLink(label: ReactNode, href: string, key: string) {
  const normalizedHref = normalizeMessageLink(href);
  if (!normalizedHref) return <Text key={key}>{label}</Text>;

  return (
    <Text
      key={key}
      accessibilityRole="link"
      onPress={() => { void Linking.openURL(normalizedHref); }}
      style={[styles.link, mine && styles.mineLink]}
    >
      {label}
    </Text>
  );
}

function renderMentions(text: string, mentionUsers: UserSummary[], keyPrefix: string) {
  const segments = messageSegments(text, mentionUsers);
  return segments.flatMap((segment, index) => {
    if (segment.mention) return [<Text key={`${keyPrefix}-mention-${index}`} style={styles.mention}>{segment.text}</Text>];

    return segment.text.split(/(@everyone(?![\p{L}\p{N}_’'-]))/giu).filter(Boolean).map((part, partIndex) => (
      <Text key={`${keyPrefix}-text-${index}-${partIndex}`} style={part.toLowerCase() === '@everyone' ? styles.mention : undefined}>{part}</Text>
    ));
  });
}

}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  content: { maxWidth: '100%', gap: 4 },
  spacer: { height: 2 },
  body: { ...typography.body, color: c.text.strong, fontFamily: fonts.regular },
  mineText: { color: c.text.body },
  bold: { fontFamily: fonts.bold },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  underline: { textDecorationLine: 'underline' },
  mention: { color: c.text.body, fontFamily: fonts.bold },
  link: { color: c.text.body, fontFamily: fonts.semibold, textDecorationLine: 'underline' },
  mineLink: { color: c.text.body },
  inlineCode: { ...typography.code, color: c.text.body, fontFamily: monoFont, backgroundColor: c.surface.sunken },
  boldCode: { fontWeight: '700' },
  heading: { ...typography.section, color: c.text.strong, fontFamily: fonts.bold, marginTop: 2 },
  subheading: { fontSize: 16, lineHeight: 22 },
  mineInlineCode: { color: c.text.body, backgroundColor: c.surface.raised },
  list: { gap: 3 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 2 },
  listMarker: { ...typography.body, minWidth: 23, flexShrink: 0, color: c.text.body, fontFamily: fonts.semibold, textAlign: 'right', paddingRight: 7 },
  listItem: { flexShrink: 1, minWidth: 0, gap: 3 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: c.text.body, paddingLeft: 10, paddingVertical: 2 },
  mineBlockquote: { borderLeftColor: c.border.strong },
  quoteText: { color: c.text.body },
}));
