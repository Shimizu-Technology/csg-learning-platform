import { makeStyles } from '@/providers/theme-provider';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { MessageCodeBlock } from '@/components/message-code-block';
import { fontScaleLimits, fonts, typography, monoFont } from '@/constants/csg-theme';
import { messageSegments } from '@/lib/mentions';
import { normalizeMessageLink, parseMessageBlocks, splitTrailingUrlPunctuation } from '@/lib/message-format';
import type { MessageListBlock } from '@/lib/message-format';
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
          return renderList(block, mentionUsers, mine, key);
        }

        if (block.type === 'blockquote') {
          return (
            <View key={key} style={[styles.blockquote, mine && styles.mineBlockquote]}>
              <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, styles.quoteText, mine && styles.mineText]}>{formatInline(block.text, mentionUsers, mine, key)}</Text>
            </View>
          );
        }

        return <Text key={key} maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(block.text, mentionUsers, mine, key)}</Text>;
      })}
    </View>
  );

function renderList(block: MessageListBlock, mentionUsers: UserSummary[], mine: boolean, key: string, depth = 0): ReactNode {
  const bullet = ['•', '◦', '▪'][depth % 3];
  return (
    <View key={key} style={styles.list}>
      {block.items.map((item, index) => {
        const itemKey = `${key}-${index}`;
        return (
          <View key={itemKey} style={styles.listRow}>
            <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.listMarker, mine && styles.mineText]}>{block.type === 'bulletList' ? bullet : `${index + 1}.`}</Text>
            <View style={styles.listItem}>
              <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(item.text, mentionUsers, mine, itemKey)}</Text>
              {item.children.map((child, childIndex) => {
                const childKey = `${itemKey}-child-${childIndex}`;
                if (child.type === 'bulletList' || child.type === 'orderedList') return renderList(child, mentionUsers, mine, childKey, depth + 1);
                if (child.type === 'blockquote') return (
                  <View key={childKey} style={[styles.blockquote, mine && styles.mineBlockquote]}>
                    <Text maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, styles.quoteText, mine && styles.mineText]}>{formatInline(child.text, mentionUsers, mine, childKey)}</Text>
                  </View>
                );
                return <Text key={childKey} maxFontSizeMultiplier={fontScaleLimits.content} style={[styles.body, mine && styles.mineText]}>{formatInline(child.text, mentionUsers, mine, childKey)}</Text>;
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatInline(text: string, mentionUsers: UserSummary[], mine: boolean, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codePattern = /`[^`]+`/g;
  const nestedFormatPattern = /(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/|www\.)/i;

  const renderNestedInline = (value: string, nestedKey: string) => (
    nestedFormatPattern.test(value)
      ? formatInline(value, mentionUsers, mine, nestedKey)
      : renderMentions(value, mentionUsers, nestedKey)
  );

  const appendFormattedText = (chunk: string, chunkKey: string) => {
    const pieces = chunk.split(/(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+)/g);

    pieces.forEach((piece, index) => {
      if (!piece) return;
      const key = `${chunkKey}-format-${index}`;

      if (piece.startsWith('**') && piece.endsWith('**')) {
        nodes.push(<Text key={key} style={styles.bold}>{renderNestedInline(piece.slice(2, -2), key)}</Text>);
        return;
      }
      if (piece.startsWith('_') && piece.endsWith('_')) {
        nodes.push(<Text key={key} style={styles.italic}>{renderNestedInline(piece.slice(1, -1), key)}</Text>);
        return;
      }
      if (piece.startsWith('~~') && piece.endsWith('~~')) {
        nodes.push(<Text key={key} style={styles.strike}>{renderNestedInline(piece.slice(2, -2), key)}</Text>);
        return;
      }
      if (piece.startsWith('++') && piece.endsWith('++')) {
        nodes.push(<Text key={key} style={styles.underline}>{renderNestedInline(piece.slice(2, -2), key)}</Text>);
        return;
      }

      nodes.push(...renderMentions(piece, mentionUsers, key));
    });
  };

  const appendTextWithLinks = (chunk: string, chunkKey: string) => {
    let cursor = 0;
    let link = nextInlineLink(chunk, cursor);

    while (link) {
      if (cursor < link.index) appendFormattedText(chunk.slice(cursor, link.index), `${chunkKey}-text-${cursor}`);

      if (link.label !== undefined) {
        appendLink(nodes, renderNestedInline(link.label, `${chunkKey}-link-label-${link.index}`), link.href, mine, `${chunkKey}-markdown-link-${link.index}`);
      } else {
        const { href, trailing } = splitTrailingUrlPunctuation(link.href);
        appendLink(nodes, href, href, mine, `${chunkKey}-bare-link-${link.index}`);
        if (trailing) nodes.push(<Text key={`${chunkKey}-trailing-${link.index}`}>{trailing}</Text>);
      }

      cursor = link.index + link.length;
      link = nextInlineLink(chunk, cursor);
    }

    if (cursor < chunk.length) appendFormattedText(chunk.slice(cursor), `${chunkKey}-tail-${cursor}`);
  };

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(text)) !== null) {
    if (cursor < match.index) appendTextWithLinks(text.slice(cursor, match.index), `${keyPrefix}-inline-${cursor}`);
    nodes.push(<Text key={`${keyPrefix}-code-${match.index}`} style={[styles.inlineCode, mine && styles.mineInlineCode]}>{match[0].slice(1, -1)}</Text>);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) appendTextWithLinks(text.slice(cursor), `${keyPrefix}-inline-${cursor}`);
  if (nodes.length === 0) return renderMentions(text, mentionUsers, `${keyPrefix}-plain`);
  return nodes;
}

type InlineLink = {
  index: number;
  length: number;
  href: string;
  label?: string;
};

function nextInlineLink(text: string, start: number): InlineLink | null {
  const markdown = nextMarkdownLink(text, start);
  const barePattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  barePattern.lastIndex = start;
  const bare = barePattern.exec(text);

  if (markdown && (!bare || markdown.index <= bare.index)) return markdown;
  if (!bare) return null;
  return { index: bare.index, length: bare[0].length, href: bare[0] };
}

function nextMarkdownLink(text: string, start: number): InlineLink | null {
  const opener = /\[([^\]]+)\]\(/g;
  opener.lastIndex = start;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(text)) !== null) {
    let cursor = opener.lastIndex;
    let depth = 1;

    while (cursor < text.length) {
      const character = text[cursor];
      if (/\s/.test(character)) break;
      if (character === '(') depth += 1;
      if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          const end = cursor + 1;
          return {
            index: match.index,
            length: end - match.index,
            label: match[1],
            href: text.slice(opener.lastIndex, cursor),
          };
        }
      }
      cursor += 1;
    }

    opener.lastIndex = match.index + 1;
  }

  return null;
}

function appendLink(nodes: ReactNode[], label: ReactNode, href: string, mine: boolean, key: string) {
  const normalizedHref = normalizeMessageLink(href);
  if (!normalizedHref) {
    nodes.push(<Text key={key}>{label}</Text>);
    return;
  }

  nodes.push(
    <Text
      key={key}
      accessibilityRole="link"
      onPress={() => { void Linking.openURL(normalizedHref); }}
      style={[styles.link, mine && styles.mineLink]}
    >
      {label}
    </Text>,
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
  mineInlineCode: { color: c.text.body, backgroundColor: c.surface.raised },
  list: { gap: 3 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 2 },
  listMarker: { ...typography.body, minWidth: 23, flexShrink: 0, color: c.text.body, fontFamily: fonts.semibold, textAlign: 'right', paddingRight: 7 },
  listItem: { flexShrink: 1, minWidth: 0, gap: 3 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: c.text.body, paddingLeft: 10, paddingVertical: 2 },
  mineBlockquote: { borderLeftColor: c.border.strong },
  quoteText: { color: c.text.body },
}));
