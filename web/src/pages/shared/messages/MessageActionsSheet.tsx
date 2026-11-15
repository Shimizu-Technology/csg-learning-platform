import { Copy, Edit3, Flag, Link2, MessageCircle, Pin, Trash2, UserRound, UserX } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { REACTIONS } from './helpers';
import type { MessagesViewContext } from './messagesPresentation';

export function MessageActionsSheet({ context }: { context: Pick<MessagesViewContext, 'isStaff' | 'activeThreadRootId' | 'setEditing' | 'setEditingInThreadPanel' | 'setAuthorContext' | 'setMobileActionsMessageId' | 'actionsFromThreadPanelRef' | 'setMessagePendingDelete' | 'setEditBody' | 'mobileActionsMessage' | 'replyToMessage' | 'copyMessage' | 'copyMessageLink' | 'reportMessage' | 'reportUser' | 'blockMessageAuthor' | 'togglePin' | 'toggleReaction'> }) {
const { isStaff, activeThreadRootId, setEditing, setEditingInThreadPanel, setAuthorContext, setMobileActionsMessageId, actionsFromThreadPanelRef, setMessagePendingDelete, setEditBody, mobileActionsMessage, replyToMessage, copyMessage, copyMessageLink, reportMessage, reportUser, blockMessageAuthor, togglePin, toggleReaction } = context
return (<>{mobileActionsMessage && (() => {
          const actionMessage = mobileActionsMessage
          const close = () => setMobileActionsMessageId(null)
          const row = 'justify-start text-left'
          return (
            <div className="space-y-2">
              <Button variant="secondary" fullWidth onClick={() => { close(); setAuthorContext(actionMessage.author) }}><UserRound className="h-4 w-4" />{isStaff && actionMessage.author.role === 'student' ? 'View student' : 'View profile'}</Button>
              {!actionMessage.blocked && (
                <div role="group" aria-label="React" className="mb-3 grid grid-cols-4 gap-2">
                  {REACTIONS.map(({ value, label, Icon }) => {
                    const reacted = Boolean(actionMessage.reactions.find((reaction) => reaction.emoji === value)?.reacted)
                    return (
                      <Button
                        key={value}
                        variant="secondary"
                        size="lg"
                        aria-label={reacted ? `Remove your ${label.toLowerCase()} reaction` : `React with ${label.toLowerCase()}`}
                        aria-pressed={reacted}
                        title={label}
                        onClick={() => {
                          void toggleReaction(actionMessage, value)
                          close()
                        }}
                        className={reacted ? 'border-info-200! bg-info-50! text-info-800!' : ''}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </Button>
                    )
                  })}
                </div>
              )}
              {!actionMessage.blocked && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    replyToMessage(actionMessage)
                    close()
                  }}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {activeThreadRootId ? 'Reply in thread' : 'Reply'}
                </Button>
              )}
              {actionMessage.body && !actionMessage.blocked && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    void copyMessage(actionMessage)
                    close()
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy message
                </Button>
              )}
              {actionMessage.id > 0 && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    void copyMessageLink(actionMessage)
                    close()
                  }}
                >
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  Copy link to message
                </Button>
              )}
              {isStaff && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    void togglePin(actionMessage)
                    close()
                  }}
                >
                  <Pin className="h-4 w-4" aria-hidden="true" />
                  {actionMessage.pinned_at ? 'Unpin message' : 'Pin message'}
                </Button>
              )}
              {actionMessage.mine && (
                <>
                  <Button
                    variant="secondary"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      setEditing(actionMessage)
                      setEditingInThreadPanel(actionsFromThreadPanelRef.current)
                      setEditBody(actionMessage.body)
                      close()
                    }}
                  >
                    <Edit3 className="h-4 w-4" aria-hidden="true" />
                    Edit message
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      setMessagePendingDelete(actionMessage)
                      close()
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete message
                  </Button>
                </>
              )}
              {!actionMessage.mine && (
                <>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      void reportMessage(actionMessage)
                      close()
                    }}
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    Report message
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      void reportUser(actionMessage)
                      close()
                    }}
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    <span className="min-w-0 truncate">Report {actionMessage.author.full_name}</span>
                  </Button>
                  {!actionMessage.blocked && (
                    <Button
                      variant="danger"
                      size="lg"
                      fullWidth
                      className={row}
                      onClick={() => {
                        void blockMessageAuthor(actionMessage)
                        close()
                      }}
                    >
                      <UserX className="h-4 w-4" aria-hidden="true" />
                      <span className="min-w-0 truncate">Block {actionMessage.author.full_name}</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          )
        })()}</>)
}
