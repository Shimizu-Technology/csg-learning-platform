import { Fragment, useMemo, type ReactNode } from 'react';
import { CodeBlock } from '../../../components/shared/CodeBlock';
import { parseInline, parseMessageBlocks, type InlineNode, type MessageListBlock } from '../../../lib/messageFormat';
import { findMentionMatches, renderLinkNode, renderTextWithMentions } from './mentions';
import { type MentionPattern } from './types';

export function FormattedMessageList({ block, mentionPatterns, depth = 0 }: { block: MessageListBlock; mentionPatterns: MentionPattern[]; depth?: number }) {
  const items = block.items.map((item, index) => (
    <li key={index} className="pl-1">
      {formatInline(item.text, mentionPatterns)}
      {item.children.map((child, childIndex) => child.type === 'paragraph'
        ? <p key={childIndex} className="whitespace-pre-wrap">{formatInline(child.text, mentionPatterns)}</p>
        : child.type === 'blockquote'
          ? <blockquote key={childIndex} className="border-l-2 border-line-strong pl-3 text-ink-secondary"><p className="whitespace-pre-wrap">{formatInline(child.text, mentionPatterns)}</p></blockquote>
          : child.type === 'code'
            ? <CodeBlock key={childIndex} code={child.code} language={child.language} surface="message" size="compact" />
            : <FormattedMessageList key={childIndex} block={child} mentionPatterns={mentionPatterns} depth={depth + 1} />)}
    </li>
  ))
  const className = "ml-5 list-outside space-y-1 pr-1 marker:text-ink-muted"
  const bulletStyle = depth === 0 ? 'list-disc' : depth === 1 ? 'list-[circle]' : 'list-[square]'
  return block.type === 'bulletList'
    ? <ul className={`${className} ${bulletStyle}`}>{items}</ul>
    : <ol start={block.start} className={`${className} list-decimal marker:font-medium`}>{items}</ol>
}

/** A message body: the shared message Markdown parser (lib/markdownCore), rendered for the web. */
export function FormattedMessage({ body, mentionPatterns: candidates = [], mentionUserIds }: { body: string; mentionPatterns?: MentionPattern[]; mentionUserIds?: number[] }) {
  const mentionPatterns = mentionUserIds === undefined ? candidates : candidates.filter((pattern) => pattern.kind === 'channel' || (pattern.userId !== undefined && mentionUserIds.includes(pattern.userId)))
  const blocks = useMemo(() => parseMessageBlocks(body), [body])

  if (!body) return null

  return (
    <div className="mt-0.5 max-w-full space-y-1 overflow-hidden break-words text-sm leading-[1.5] text-ink-secondary [overflow-wrap:anywhere] [&_.code-block]:my-1 [&_.code-block]:[overflow-wrap:normal]">
      {blocks.map((block, index) => {
        const key = `${index}-${
          block.type === 'code'
            ? block.code.slice(0, 12)
            : block.type === 'paragraph' || block.type === 'blockquote' || block.type === 'heading'
              ? block.text.slice(0, 12)
              : 'spacer'
        }`
        if (block.type === 'spacer') {
          return <div key={key} className="h-0.5" aria-hidden="true" />
        }

        if (block.type === 'code') {
          return <CodeBlock key={key} code={block.code} language={block.language} surface="message" size="compact" />
        }

        if (block.type === 'bulletList' || block.type === 'orderedList') {
          return <FormattedMessageList key={key} block={block} mentionPatterns={mentionPatterns} />
        }

        if (block.type === 'heading') {
          const Heading = block.level === 2 ? 'h3' : 'h4'
          return <Heading key={key} className={`${block.level === 2 ? 'text-base' : 'text-sm'} pt-1 font-bold text-ink`}>{formatInline(block.text, mentionPatterns)}</Heading>
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key} className="border-l-2 border-line-strong pl-3 text-ink-secondary">
              <p className="whitespace-pre-wrap">{formatInline(block.text, mentionPatterns)}</p>
            </blockquote>
          )
        }

        return <p key={key} className="whitespace-pre-wrap">{formatInline(block.text, mentionPatterns)}</p>
      })}
    </div>
  )
}

export function formatInline(text: string, mentionPatterns: MentionPattern[]) {
  return renderInlineNodes(parseInline(text), mentionPatterns, 'inline')
}

export function renderInlineNodes(nodes: InlineNode[], mentionPatterns: MentionPattern[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{findMentionMatches(node.text, mentionPatterns).length > 0 ? renderTextWithMentions(node.text, mentionPatterns) : node.text}</Fragment>
      case 'code':
        return <code key={key} className="rounded-[5px] border border-code-line bg-code-inline-bg px-1 py-px font-mono text-[0.86em] text-ink">{node.text}</code>
      case 'strong':
        return <strong key={key}>{renderInlineNodes(node.children, mentionPatterns, key)}</strong>
      case 'emphasis':
        return <em key={key}>{renderInlineNodes(node.children, mentionPatterns, key)}</em>
      case 'strike':
        return <del key={key}>{renderInlineNodes(node.children, mentionPatterns, key)}</del>
      case 'underline':
        return <u key={key}>{renderInlineNodes(node.children, mentionPatterns, key)}</u>
      case 'link':
        return renderLinkNode(renderInlineNodes(node.children, mentionPatterns, key), node.href, key)
    }
  })
}
