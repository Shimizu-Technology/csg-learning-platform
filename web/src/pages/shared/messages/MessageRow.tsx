import { CheckCheck, ChevronRight, Copy, Download, Edit3, File, Link2, MessageCircle, MoreHorizontal, Pin, SmilePlus, Trash2, Users } from 'lucide-react';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { Button, IconButton } from '../../../components/ui/Button';
import { SentViaIndicator } from '../../../components/shared/SentViaIndicator';
import { formatFileSize } from '../../../lib/uploadToS3';
import { useMessageLongPress } from '../../../lib/useMessageLongPress';
import type { MessageAttachment } from '../../../types/api';
import { FormattedMessage } from './FormattedMessage';
import { QUICK_HOVER_REACTIONS, REACTIONS_BY_VALUE, formatInboxTime, formatTime, readReceiptLabel, readReceiptTitle } from './helpers';
import { MessageEditSurface } from './MessageEditSurface';
import { type LocalMessage, type MentionPattern, type ReadReceipts } from './types';

export function MessageRow({
  message,
  readReceipts,
  compact,
  highlighted,
  entering = false,
  onEntered,
  editing,
  editBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onCopy,
  onCopyLink,
  onRetry,
  onDiscard,
  onRestore,
  onOpenAuthor,
  onOpenActions,
  onPin,
  canPin,
  inThreadView,
  replyCount,
  threadRepliesList = [],
  latestReplyAt,
  onReply,
  onReact,
  onInspectReaction,
  onOpenImage,
  mentionPatterns,
}: {
  message: LocalMessage
  readReceipts?: ReadReceipts
  compact: boolean
  highlighted: boolean
  /** True only for a message that arrived while this conversation was open. */
  entering?: boolean
  onEntered?: () => void
  editing: boolean
  editBody: string
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => void
  onDelete: () => void
  onCopy: () => void
  /** Copies a link that opens the conversation at this message (L-2.8). */
  onCopyLink?: () => void
  onRetry: () => void
  onDiscard: () => void
  onRestore: () => void
  onOpenAuthor: () => void
  onOpenActions: () => void
  onPin: () => void
  canPin: boolean
  inThreadView: boolean
  replyCount: number
  threadRepliesList?: LocalMessage[]
  latestReplyAt?: string
  onReply: () => void
  onReact: (emoji: string) => void
  onInspectReaction: (emoji: string) => void
  onOpenImage: (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => void
  mentionPatterns: MentionPattern[]
}) {
  const longPress = useMessageLongPress(onOpenActions, !editing && !message.pending && !message.failed)
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)
  const fileAttachments = message.attachments.filter((attachment) => !(attachment.image && attachment.url))
  const uniqueReplyAuthors = Array.from(
    new Map(threadRepliesList.map((reply) => [reply.author.id, reply.author])).values(),
  ).slice(0, 3)

  return (
    <div
      {...longPress}
      id={`message-${message.id}`}
      onAnimationEnd={entering && onEntered ? (event) => {
        if (event.target === event.currentTarget && event.animationName === 'message-row-enter') onEntered()
      } : undefined}
      className={`message-row group relative flex w-full max-w-full min-w-0 gap-2 rounded-xl px-1.5 py-1 transition-[background-color,box-shadow,opacity] duration-150 hover:bg-surface-hover/90 sm:gap-3 sm:px-3 ${
        compact ? 'mt-0 py-0.5' : 'mt-2.5'
      } ${entering ? 'message-row-enter' : ''} ${message.pinned_at ? 'bg-surface-sunken ring-1 ring-line' : ''} ${message.pending ? 'opacity-75' : ''} ${
        highlighted ? 'message-row-highlight bg-info-soft ring-2 ring-info-line' : ''
      }`}
    >
      <div className="flex w-10 shrink-0 justify-center sm:w-9">
        {compact ? (
          <span className="hidden whitespace-nowrap pt-1 text-[11px] font-medium tabular-nums text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:block">
            {new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <button
            type="button"
            aria-label={`View ${message.author.full_name}`}
            onClick={onOpenAuthor}
            className="flex min-h-11 min-w-11 items-start justify-center rounded-full pt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:min-h-0 sm:min-w-0"
          >
            <Avatar name={message.author.full_name} src={message.author.avatar_url} size="sm" className="sm:h-9 sm:w-9" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {!compact && (
          <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${inThreadView ? 'lg:pr-12' : ''}`}>
            <button
              type="button"
              onClick={onOpenAuthor}
              className="inline-flex min-h-11 min-w-11 max-w-full items-center rounded-md text-left text-sm font-semibold leading-5 text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus [overflow-wrap:anywhere] sm:min-h-0 sm:min-w-0"
            >
              {message.author.full_name}
            </button>
            <span className="text-xs tabular-nums text-ink-muted">{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="text-xs text-ink-muted">(edited)</span>}
            <SentViaIndicator label={message.sent_via_label} />
            {message.pending && <span className="text-xs text-ink-muted">Sending…</span>}
            {message.failed && <span className="text-xs font-medium text-danger-ink">Not sent</span>}
            {message.pinned_at && <Badge icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>}
          </div>
        )}
        {message.blocked ? (
          <p className="text-sm italic text-ink-muted">Message hidden — you blocked this user</p>
        ) : editing ? (
          <MessageEditSurface
            initialValue={editBody}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <div className={!compact ? 'mt-0.5' : undefined}>
            <FormattedMessage body={message.body} mentionPatterns={mentionPatterns} mentionUserIds={message.mention_user_ids} />
          </div>
        )}
        {message.failed && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger-ink" role="status">
            <span className="min-w-0 flex-1">{message.failureError || 'This message was not sent.'}</span>
            {message.retrySend ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onRestore}>
                {message.body ? 'Restore text' : 'Reattach files'}
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        )}
        {!message.blocked && imageAttachments.length === 1 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onOpenImage(imageAttachments[0], imageAttachments)}
              aria-label={`Open image ${imageAttachments[0].filename}`}
              className="group/media block max-w-full overflow-hidden rounded-xl border border-line bg-surface-sunken text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:max-w-md"
            >
              <img
                src={imageAttachments[0].url}
                alt={imageAttachments[0].filename}
                width={640}
                height={360}
                className="h-auto max-h-80 w-auto max-w-full object-contain"
              />
              <span className="flex items-center justify-between gap-2 border-t border-line bg-surface-raised px-2.5 py-1.5 text-xs text-ink-muted">
                <span className="min-w-0 truncate font-medium text-ink-secondary" title={imageAttachments[0].filename}>{imageAttachments[0].filename}</span>
                <span className="shrink-0 tabular-nums">{formatFileSize(imageAttachments[0].byte_size)}</span>
              </span>
            </button>
          </div>
        )}
        {!message.blocked && imageAttachments.length > 1 && (
          <div className="mt-2 grid max-w-lg grid-cols-2 gap-2">
            {imageAttachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                onClick={() => onOpenImage(attachment, imageAttachments)}
                aria-label={`Open image ${attachment.filename}`}
                className="group/media block overflow-hidden rounded-xl border border-line bg-surface-sunken text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <img
                  src={attachment.url}
                  alt={attachment.filename}
                  width={640}
                  height={360}
                  className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover/media:scale-[1.02] motion-reduce:transform-none"
                />
                <span className="flex items-center justify-between gap-2 border-t border-line bg-surface-raised px-2 py-1 text-xs text-ink-muted">
                  <span className="min-w-0 truncate font-medium text-ink-secondary" title={attachment.filename}>{attachment.filename}</span>
                  <span className="shrink-0 tabular-nums">{formatFileSize(attachment.byte_size)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!message.blocked && fileAttachments.length > 0 && (
          <div className="mt-2 grid max-w-lg min-w-0 gap-2 sm:grid-cols-2">
            {fileAttachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.url}
                download={attachment.filename}
                className="pressable flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-raised p-2.5 text-sm text-ink-secondary hover:border-line-strong hover:bg-surface-sunken"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted">
                  <File className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink" title={attachment.filename}>{attachment.filename}</span>
                  <span className="block text-xs tabular-nums text-ink-muted">{formatFileSize(attachment.byte_size)}</span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
        {message.mine && readReceipts && readReceipts.count > 0 && (
          <div
            className="mt-1 inline-flex max-w-full min-w-0 items-center gap-1 text-[11px] font-medium text-ink-muted"
            title={readReceiptTitle(readReceipts)}
            aria-label={`Seen by ${readReceiptTitle(readReceipts)}`}
          >
            <CheckCheck className="h-3.5 w-3.5 shrink-0 text-info-ink" aria-hidden="true" />
            <span className="truncate">Seen by {readReceiptLabel(readReceipts)}</span>
          </div>
        )}
        {!message.blocked && message.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {message.reactions.map((reaction) => {
              const reactionDisplay = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
              const ReactionIcon = reactionDisplay.Icon
              return (
                <div key={reaction.emoji} className="group/reaction relative">
                  <button
                    type="button"
                    aria-pressed={reaction.reacted}
                    onClick={() => onReact(reaction.emoji)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onInspectReaction(reaction.emoji)
                    }}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:active:scale-100 ${
                      reaction.reacted
                        ? 'border-info-line bg-info-soft text-info-ink'
                        : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:bg-surface-sunken hover:text-ink'
                    }`}
                    aria-label={`${reactionDisplay.label}: ${reaction.count}${reaction.reacted ? ', including you. Click to remove.' : '. Click to react.'}`}
                  >
                    <ReactionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{reaction.count}</span>
                  </button>
                  {reaction.users.length > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-surface-inverse px-2.5 py-1.5 text-xs text-ink-on-inverse shadow-overlay group-hover/reaction:block">
                      <div className="font-semibold">{reactionDisplay.label}</div>
                      <div className="mt-0.5 whitespace-nowrap opacity-90">{reaction.users.map((user) => user.full_name).join(', ')}</div>
                    </div>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => onInspectReaction(message.reactions[0].emoji)}
              aria-label="Who reacted"
              title="Who reacted"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        {!message.blocked && !inThreadView && replyCount > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={onReply}
              className="group/thread inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-transparent px-2 py-1 text-xs transition-[background-color,border-color] duration-150 hover:border-line hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {uniqueReplyAuthors.length > 0 ? (
                <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                  {uniqueReplyAuthors.map((author) => (
                    <Avatar
                      key={author.id}
                      name={author.full_name}
                      src={author.avatar_url}
                      size="sm"
                      className="h-5! w-5! text-[10px]! ring-2 ring-surface-raised"
                    />
                  ))}
                </span>
              ) : (
                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-primary-ink" aria-hidden="true" />
              )}
              <span className="shrink-0 font-semibold tabular-nums text-primary-ink">
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </span>
              <span className="truncate text-ink-muted">
                {latestReplyAt ? `Last reply ${formatInboxTime(latestReplyAt)}` : 'View thread'}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-hover/thread:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {!message.pending && !message.failed && <div className="ml-auto flex shrink-0 items-start gap-1 lg:hidden">
        <IconButton label="Open message actions" onClick={onOpenActions}>
          <MoreHorizontal className="h-5 w-5" />
        </IconButton>
      </div>}
      {!message.pending && !message.failed && (
        <div
          role="toolbar"
          aria-label="Message actions"
          className={`pointer-events-none absolute top-1 right-2 z-10 hidden translate-y-0.5 items-center gap-0.5 rounded-xl border border-line bg-surface-raised p-1 shadow-overlay opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:transform-none lg:flex [&_button]:h-7! [&_button]:min-h-7! [&_button]:w-7! [&_button]:min-w-7! [&_button]:rounded-lg! ${inThreadView ? '[&>:not(:last-child)]:hidden' : ''}`}
        >
          {!message.blocked && QUICK_HOVER_REACTIONS.map(({ value, label, Icon }) => (
            <IconButton key={value} size="sm" label={`React with ${label.toLowerCase()}`} onClick={() => onReact(value)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          ))}
          {!message.blocked && <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />}
          {!message.blocked && (
            <IconButton size="sm" label={inThreadView ? 'Reply in thread' : 'Reply'} onClick={onReply}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {!message.blocked && message.body && (
            <IconButton size="sm" label="Copy message" onClick={onCopy}>
              <Copy className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {onCopyLink && (
            <IconButton size="sm" label="Copy link to message" onClick={onCopyLink}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {canPin && (
            <IconButton size="sm" label={message.pinned_at ? 'Unpin message' : 'Pin message'} onClick={onPin}>
              <Pin className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {message.mine && (
            <>
              <IconButton size="sm" label="Edit message" onClick={onStartEdit}>
                <Edit3 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton size="sm" variant="quiet" label="Delete message" onClick={onDelete} className="hover:bg-danger-soft! hover:text-danger-ink!">
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </>
          )}
          <IconButton size="sm" label="More message actions" onClick={onOpenActions}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  )
}
