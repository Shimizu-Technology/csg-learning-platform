import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { MessageCodeBlock } from '@/components/message-code-block';
import { fonts, palette } from '@/constants/csg-theme';
import { messageSegments } from '@/lib/mentions';
import { normalizeMessageLink, parseMessageBlocks, splitTrailingUrlPunctuation } from '@/lib/message-format';
import type { UserSummary } from '@/lib/types';

type Props = {
  body: string;
  mentionUsers: UserSummary[];
  mine?: boolean;
};

export function FormattedMessage({ body, mentionUsers, mine = false }: Props) {
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
          return (
            <View key={key} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={`${key}-${itemIndex}`} style={styles.listRow}>
                  <Text style={[styles.listMarker, mine && styles.mineText]}>{block.type === 'bulletList' ? '•' : `${itemIndex + 1}.`}</Text>
                  <Text style={[styles.body, styles.listItem, mine && styles.mineText]}>{formatInline(item, mentionUsers, mine, `${key}-${itemIndex}`)}</Text>
                </View>
              ))}
            </View>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <View key={key} style={[styles.blockquote, mine && styles.mineBlockquote]}>
              <Text style={[styles.body, styles.quoteText, mine && styles.mineText]}>{formatInline(block.text, mentionUsers, mine, key)}</Text>
            </View>
          );
        }

        return <Text key={key} style={[styles.body, mine && styles.mineText]}>{formatInline(block.text, mentionUsers, mine, key)}</Text>;
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

const styles = StyleSheet.create({
  content: { maxWidth: '100%', gap: 4 },
  spacer: { height: 2 },
  body: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  mineText: { color: '#FFFFFF' },
  bold: { fontFamily: fonts.bold },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  underline: { textDecorationLine: 'underline' },
  mention: { color: '#FFD1D7', fontFamily: fonts.bold },
  link: { color: palette.rubySoft, fontFamily: fonts.semibold, textDecorationLine: 'underline' },
  mineLink: { color: '#FFE4E8' },
  inlineCode: { color: '#F5A3AF', fontFamily: 'Menlo', fontSize: 12, backgroundColor: '#20151A' },
  mineInlineCode: { color: '#FFFFFF', backgroundColor: 'rgba(6, 9, 14, 0.28)' },
  list: { gap: 3 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 2 },
  listMarker: { width: 23, color: palette.muted, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 20, textAlign: 'right', paddingRight: 7 },
  listItem: { flex: 1 },
  blockquote: { borderLeftWidth: 3, borderLeftColor: palette.rubySoft, paddingLeft: 10, paddingVertical: 2 },
  mineBlockquote: { borderLeftColor: '#FFE4E8' },
  quoteText: { color: '#D6D9E1' },
});
