import { CheckCheck, Copy, Download, Edit3, File, MessageCircle, MoreHorizontal, Pin, SmilePlus, Trash2 } from 'lucide-react';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { Button, IconButton } from '../../../components/ui/Button';
import { RowButton } from '../../../components/ui/RowButton';
import { formatFileSize } from '../../../lib/uploadToS3';
import { useMessageLongPress } from '../../../lib/useMessageLongPress';
import type { MessageAttachment } from '../../../types/api';
import { FormattedMessage } from './FormattedMessage';
import { REACTIONS, REACTIONS_BY_VALUE, formatTime, readReceiptLabel, readReceiptTitle } from './helpers';
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
  onRetry,
  onDiscard,
  onRestore,
  onOpenAuthor,
  onOpenActions,
  onPin,
  canPin,
  inThreadView,
  replyCount,
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
  onRetry: () => void
  onDiscard: () => void
  onRestore: () => void
  onOpenAuthor: () => void
  onOpenActions: () => void
  onPin: () => void
  canPin: boolean
  inThreadView: boolean
  replyCount: number
  onReply: () => void
  onReact: (emoji: string) => void
  onInspectReaction: (emoji: string) => void
  onOpenImage: (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => void
  mentionPatterns: MentionPattern[]
}) {
  const longPress = useMessageLongPress(onOpenActions, !editing && !message.pending && !message.failed)
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)

  return (
    <div
      {...longPress}
      id={`message-${message.id}`}
      onAnimationEnd={entering && onEntered ? (event) => {
        if (event.target === event.currentTarget && event.animationName === 'message-row-enter') onEntered()
      } : undefined}
      className={`message-row group relative flex w-full max-w-full min-w-0 gap-1.5 rounded-xl px-1.5 py-0.5 transition-[background-color,box-shadow,opacity] duration-200 hover:bg-slate-50/90 sm:gap-3 sm:px-3 ${
        compact ? 'mt-0' : 'mt-1.5'
      } ${entering ? 'message-row-enter' : ''} ${message.pinned_at ? 'bg-surface-sunken ring-1 ring-line' : ''} ${message.pending ? 'opacity-75' : ''} ${
        highlighted ? 'message-row-highlight bg-info-50 ring-2 ring-info-200' : ''
      }`}
    >
      <div className="flex w-11 shrink-0 justify-center">
        {compact ? (
          <span className="hidden whitespace-nowrap pt-1 text-xs font-medium tabular-nums text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:block">
            {new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <button type="button" aria-label={`View ${message.author.full_name}`} onClick={onOpenAuthor} className="flex min-h-11 min-w-11 items-start justify-center rounded-xl pt-1"><Avatar name={message.author.full_name} src={message.author.avatar_url} size="sm" className="sm:h-9 sm:w-9" /></button>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {!compact && (
          <div className={`flex flex-wrap items-center gap-2 ${inThreadView ? 'lg:pr-12' : ''}`}>
            <button type="button" onClick={onOpenAuthor} className="min-h-11 min-w-11 max-w-full rounded-lg text-left text-sm font-semibold text-ink hover:underline [overflow-wrap:anywhere]">{message.author.full_name}</button>
            <span className="text-xs tabular-nums text-ink-muted">{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="text-xs text-ink-muted">Edited</span>}
            {message.pending && <span className="text-xs text-ink-muted">Sending...</span>}
            {message.failed && <span className="text-xs font-medium text-danger-700">Not sent</span>}
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
          <FormattedMessage body={message.body} mentionPatterns={mentionPatterns} />
        )}
        {message.failed && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700" role="status">
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
        {!message.blocked && message.attachments.length > 0 && (
          <div className="mt-3 grid max-w-full min-w-0 gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => (
              attachment.image && attachment.url ? (
              <RowButton
                key={attachment.id}
                onClick={() => onOpenImage(attachment, imageAttachments)}
                aria-label={`Open image ${attachment.filename}`}
                className="block rounded-xl border border-line bg-surface-raised p-2 text-sm text-ink-secondary hover:border-line-strong"
              >
                <img src={attachment.url} alt="" width={640} height={360} className="mb-2 aspect-video max-h-56 w-full rounded-lg object-cover" />
                <span className="block truncate font-semibold text-ink" title={attachment.filename}>{attachment.filename}</span>
                <span className="block text-xs tabular-nums text-ink-muted">{formatFileSize(attachment.byte_size)}</span>
              </RowButton>
              ) : (
              <a
                key={attachment.id}
                href={attachment.url}
                download={attachment.filename}
                className="pressable flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-raised p-2 text-sm text-ink-secondary hover:border-line-strong hover:bg-surface-sunken"
              >
                <File className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink" title={attachment.filename}>{attachment.filename}</span>
                  <span className="block text-xs tabular-nums text-ink-muted">{formatFileSize(attachment.byte_size)}</span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </a>
              )
            ))}
          </div>
        )}
        {message.mine && readReceipts && readReceipts.count > 0 && (
          <div
            className="mt-1 inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-muted"
            title={readReceiptTitle(readReceipts)}
            aria-label={`Seen by ${readReceiptTitle(readReceipts)}`}
          >
            <CheckCheck className="h-3 w-3 shrink-0 text-success-700" />
            <span className="truncate">Seen by {readReceiptLabel(readReceipts)}</span>
          </div>
        )}
        {!message.blocked && (message.reactions.length > 0 || (!inThreadView && replyCount > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {message.reactions.map((reaction) => {
            const reactionDisplay = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
            const ReactionIcon = reactionDisplay.Icon
            return (
              <div key={reaction.emoji} className="group/reaction relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onInspectReaction(reaction.emoji)}
                  className={`gap-1.5 px-2.5 text-xs tabular-nums shadow-none! ${reaction?.reacted ? 'border-info-200! bg-info-50! text-info-800!' : 'font-medium! text-ink-secondary!'}`}
                  aria-label={`${reactionDisplay.label}: ${reaction?.count || 0}${reaction?.reacted ? ', including you' : ''}. Show who reacted.`}
                >
                  <ReactionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {reaction?.count || ''}
                </Button>
                {reaction && reaction.users.length > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-overlay group-hover/reaction:block">
                    <div className="font-medium">{reactionDisplay.label}</div>
                    <div className="mt-1 whitespace-nowrap">{reaction.users.map((user) => user.full_name).join(', ')}</div>
                  </div>
                )}
              </div>
            )
          })}
          {!inThreadView && replyCount > 0 && (
            <Button variant="quiet" size="sm" onClick={onReply} className="gap-1.5 px-2.5 text-xs tabular-nums text-ink!">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </Button>
          )}
        </div>
        )}
      </div>
      {!message.pending && !message.failed && <div className="ml-auto flex shrink-0 items-start gap-1 lg:hidden">
        <IconButton label="Open message actions" onClick={onOpenActions}>
          <MoreHorizontal className="h-5 w-5" />
        </IconButton>
      </div>}
      {!message.pending && !message.failed && <div role="toolbar" aria-label="Message actions" className={`absolute right-2 top-1 z-10 hidden items-center gap-0.5 rounded-xl border border-line bg-surface-raised p-1 shadow-overlay opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:flex ${inThreadView ? '[&>button:not(:last-child)]:hidden' : ''}`}>
        {!message.blocked && REACTIONS.map(({ value, label, Icon }) => (
          <IconButton key={value} size="sm" label={`React with ${label.toLowerCase()}`} onClick={() => onReact(value)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ))}
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
            <IconButton size="sm" variant="quiet" label="Delete message" onClick={onDelete} className="hover:bg-danger-50! hover:text-danger-700!">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </>
        )}
        <IconButton size="sm" label="More message actions" onClick={onOpenActions}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>}
    </div>
  )
}
