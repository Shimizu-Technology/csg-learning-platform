import { parseMessageBlocks, parseInline, type InlineNode, type MessageBlock } from '../../../lib/markdownCore';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { type ReactNode } from 'react';
import { CHANNEL_MENTION_ALIASES, COMMON_FILE_EXTENSIONS } from './helpers';
import { MessageLink } from './MessageLink';
import { type MentionPattern, type MentionableUser } from './types';

export function stripMentionLabel(value: string) {
  return value.replace(/^@/, '').trim().toLowerCase()
}

export function escapeMentionRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isMentionStartBoundary(text: string, index: number) {
  if (index === 0) return true
  return /[\s([{'"“‘>]/.test(text[index - 1] || '')
}

export function isMentionEndBoundary(char?: string) {
  return !char || /[\s)\]}.,!?;:'"”’]/.test(char)
}

export function messageContainsMention(body: string, fullName: string) {
  const trimmed = fullName.trim()
  if (!trimmed) return false

  const pattern = new RegExp(`(^|[^\\w])@${escapeMentionRegExp(trimmed)}(?=$|[\\s)\\]}.,!?;:'"”’])`, 'i')
  return mentionProse(body).some((text) => pattern.test(text))
}

export function resolveMentionedUserIds(body: string, mentionableUsers: MentionableUser[], selectedIds: number[]) {
  if (!body.trim()) return []

  const usersById = new Map(mentionableUsers.map((user) => [user.id, user]))
  const nameCounts = mentionableUsers.reduce((counts, user) => {
    const normalized = user.full_name.trim().toLowerCase()
    if (!normalized) return counts

    counts.set(normalized, (counts.get(normalized) || 0) + 1)
    return counts
  }, new Map<string, number>())

  const resolved = selectedIds.filter((id) => {
    const user = usersById.get(id)
    return Boolean(user?.full_name && messageContainsMention(body, user.full_name))
  })

  mentionableUsers.forEach((user) => {
    const normalized = user.full_name.trim().toLowerCase()
    if (!normalized) return
    if ((nameCounts.get(normalized) || 0) > 1) return
    if (!messageContainsMention(body, user.full_name)) return
    if (resolved.includes(user.id)) return

    resolved.push(user.id)
  })

  return resolved
}

export function buildMentionPatterns(names: string[], includeChannel: boolean) {
  const seen = new Set<string>()
  const patterns: MentionPattern[] = []

  if (includeChannel) {
    CHANNEL_MENTION_ALIASES.forEach((mention) => {
      const normalized = mention.label.toLowerCase()
      seen.add(normalized)
      patterns.push({ label: mention.label, normalized, kind: 'channel' })
    })
  }

  names
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name) => {
      const label = `@${name}`
      const normalized = label.toLowerCase()
      if (seen.has(normalized)) return
      seen.add(normalized)
      patterns.push({ label, normalized, kind: 'user' })
    })

  return patterns.sort((left, right) => right.label.length - left.label.length)
}

export function findMentionMatches(text: string, patterns: MentionPattern[]) {
  const matches: Array<{ from: number; to: number; kind: MentionPattern['kind']; me?: boolean; text: string }> = []
  let index = 0

  while (index < text.length) {
    if (text[index] !== '@' || !isMentionStartBoundary(text, index)) {
      index += 1
      continue
    }

    const match = patterns.find((pattern) => {
      if (text.slice(index, index + pattern.label.length).toLowerCase() !== pattern.normalized) return false
      return isMentionEndBoundary(text[index + pattern.label.length])
    })

    if (!match) {
      index += 1
      continue
    }

    matches.push({
      from: index,
      to: index + match.label.length,
      kind: match.kind,
      me: match.me,
      text: text.slice(index, index + match.label.length),
    })
    index += match.label.length
  }

  return matches
}

export function renderTextWithMentions(text: string, patterns: MentionPattern[]) {
  const matches = findMentionMatches(text, patterns)
  if (matches.length === 0) return [<span key="text-0">{text}</span>]

  const nodes: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (cursor < match.from) {
      nodes.push(<span key={`text-${index}-${cursor}`}>{text.slice(cursor, match.from)}</span>)
    }

    nodes.push(
      <span
        key={`mention-${index}-${match.from}`}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
          match.kind === 'channel'
            ? 'border border-info-line bg-info-soft text-info-ink'
            : match.me ? 'bg-primary-soft text-primary-soft-ink' : 'bg-info-soft text-info-ink'
        }`}
      >
        {match.text}
      </span>,
    )

    cursor = match.to
  })

  if (cursor < text.length) {
    nodes.push(<span key={`text-tail-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return nodes
}

export function normalizeLinkHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`

  const bareDomainMatch = trimmed.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)([/?#].*)?$/i)
  if (!bareDomainMatch) return ''

  const tld = bareDomainMatch[1].split('.').pop()?.toLowerCase() || ''
  if (!/^[a-z]{2,24}$/.test(tld) || COMMON_FILE_EXTENSIONS.has(tld)) return ''

  return `https://${trimmed}`
}

export function renderLinkNode(text: ReactNode, href: string, key: string) {
  const normalizedHref = normalizeLinkHref(href)
  if (!normalizedHref) return <span key={key}>{text}</span>

  return (
    <MessageLink
      key={key}
      href={normalizedHref}
      className="font-medium text-primary-ink underline decoration-primary-soft-line underline-offset-2 transition-colors hover:text-primary-soft-ink hover:decoration-primary-ink"
    >
      {text}
    </MessageLink>
  )
}

export const mentionHighlightPluginKey = new PluginKey('messageMentionHighlight')

export const MentionHighlightExtension = Extension.create<{ getPatterns: () => MentionPattern[] }>({
  name: 'messageMentionHighlight',

  addOptions() {
    return {
      getPatterns: () => [],
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionHighlightPluginKey,
        props: {
          decorations: (state) => {
            const patterns = this.options.getPatterns()
            if (patterns.length === 0) return null

            const decorations: Decoration[] = []

            state.doc.descendants((node, pos, parent) => {
              if (!node.isText || !node.text) return
              if (parent?.type.name === 'codeBlock') return
              if (node.marks.some((mark) => mark.type.name === 'code')) return

              findMentionMatches(node.text, patterns).forEach((match) => {
                decorations.push(Decoration.inline(pos + match.from, pos + match.to, {
                  class: match.kind === 'channel'
                    ? 'message-mention message-mention--channel'
                    : 'message-mention',
                }))
              })
            })

            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null
          },
        },
      }),
    ]
  },
})

/** Only prose can contain a mention; code spans and code blocks never notify. */
function mentionProse(body: string): string[] {
  const inline = (nodes: InlineNode[]): string => nodes.map((node) => node.type === 'code' ? '' : node.type === 'text' ? node.text : inline(node.children)).join('');
  const blocks = (items: MessageBlock[]): string[] => items.flatMap((block) => {
    if (block.type === 'code' || block.type === 'spacer') return [];
    if (block.type === 'bulletList' || block.type === 'orderedList') return block.items.flatMap((item) => [inline(parseInline(item.text)), ...blocks(item.children)]);
    return [inline(parseInline(block.text))];
  });
  return blocks(parseMessageBlocks(body));
}
