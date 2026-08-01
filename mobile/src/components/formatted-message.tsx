import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

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
          return (
            <View key={key} style={styles.codeBlock}>
              {!!block.language && <Text style={styles.codeLanguage}>{block.language}</Text>}
              <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={styles.codeScroller} contentContainerStyle={styles.codeScroll}>
                <Text selectable style={styles.codeText}>{block.code}</Text>
              </ScrollView>
            </View>
          );
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
  const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
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
    let match: RegExpExecArray | null;

    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(chunk)) !== null) {
      if (cursor < match.index) appendFormattedText(chunk.slice(cursor, match.index), `${chunkKey}-text-${cursor}`);

      if (match[1] !== undefined && match[2] !== undefined) {
        appendLink(nodes, renderNestedInline(match[1], `${chunkKey}-link-label-${match.index}`), match[2], mine, `${chunkKey}-markdown-link-${match.index}`);
      } else {
        const { href, trailing } = splitTrailingUrlPunctuation(match[3]);
        appendLink(nodes, href, href, mine, `${chunkKey}-bare-link-${match.index}`);
        if (trailing) nodes.push(<Text key={`${chunkKey}-trailing-${match.index}`}>{trailing}</Text>);
      }

      cursor = match.index + match[0].length;
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
  codeBlock: { maxWidth: '100%', overflow: 'hidden', borderRadius: 12, backgroundColor: '#080A0E', borderWidth: 1, borderColor: '#303542' },
  codeScroller: { flexGrow: 0, flexShrink: 1 },
  codeLanguage: { color: '#9CA3AF', fontFamily: fonts.bold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#303542' },
  codeScroll: { minWidth: '100%', paddingHorizontal: 12, paddingVertical: 10 },
  codeText: { color: '#E5E7EB', fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 },
});
