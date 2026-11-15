import { CheckCheck, Check, ChevronLeft, ChevronRight, Download, Hash, MessageCircle, SmilePlus, Users, X } from 'lucide-react';
import { MessageAuthorContext } from '../../../components/shared/MessageAuthorContext';
import { Modal } from '../../../components/shared/Modal';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge } from '../../../components/ui/Badge';
import { AnchorButton, Button, IconButton } from '../../../components/ui/Button';
import { TabButton } from '../../../components/ui/Choice';
import { CountBadge, RowButton } from '../../../components/ui/RowButton';
import { formatFileSize } from '../../../lib/uploadToS3';
import { recipientLabel, WorkspaceMemberIdentity } from './ConversationControls';
import { channelInitials, formatTime, preview, REACTIONS_BY_VALUE } from './helpers';
import { MessageActionsSheet } from './MessageActionsSheet';
import type { AttachmentLightbox } from './useAttachmentLightbox';
import type { ConversationState } from './useConversationState';
import type { ConversationWindow } from './useConversationWindow';
import type { MessageMutations } from './useMessageMutations';
import type { MessageOverlays } from './useMessageOverlays';
import type { MessagesRoute } from './useMessagesRoute';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';

type MessagesDialogsProps = {
  toast: { error: (message: string) => void }
  sourceRecord: MessagesRoute['sourceRecord']
  conversation: Pick<ConversationState, 'activeThreadRootId' | 'setEditing' | 'setEditingInThreadPanel' | 'setEditBody'>
  directory: WorkspaceDirectory
  feed: Pick<ConversationWindow, 'conversationReturnContext' | 'replyToMessage'>
  overlays: MessageOverlays
  lightbox: AttachmentLightbox
  mutations: Pick<MessageMutations, 'deleteMessage' | 'copyMessage' | 'copyMessageLink' | 'reportMessage' | 'reportUser' | 'blockMessageAuthor' | 'togglePin' | 'toggleReaction'>
}

/** Every dialog the messages page opens: reactions, workspaces and members, channels, delete, message actions, new DM, author context and the image lightbox. */
export function MessagesDialogs({ toast, sourceRecord, conversation, directory, feed, overlays, lightbox, mutations }: MessagesDialogsProps) {
  const { isStaff, isAdmin, workspaces, workspaceDetail, availableUsers, selectedWorkspaceId, creatingChannel, creatingWorkspace, showChannelForm, setShowChannelForm, showDmForm, setShowDmForm, showWorkspaceForm, setShowWorkspaceForm, showWorkspaceSwitcher, setShowWorkspaceSwitcher, showWorkspaceMembers, setShowWorkspaceMembers, workspaceError, setWorkspaceError, channelError, setChannelError, dmUserId, setDmUserId, memberToAddId, setMemberToAddId, workspaceForm, setWorkspaceForm, channelForm, setChannelForm, selected, selectedDmStudent, selectedWorkspace, canManageChannels, sortedWorkspaceCards, memberCandidates, markWorkspaceRead, selectWorkspace, handleCreateChannel, handleCreateWorkspace, handleAddWorkspaceMember, handleRemoveWorkspaceMember, handleCreateDm } = directory
  const { conversationReturnContext, replyToMessage } = feed
  const { setReactionDetails, reactionDetailsMessage, selectedReaction, authorContext, setAuthorContext, mobileActionsMessage, setMobileActionsMessageId, messagePendingDelete, setMessagePendingDelete } = overlays
  const { lightboxAttachments, lightboxIndex, lightboxAttachment, lightboxTouchStartX, showPreviousLightboxImage, showNextLightboxImage, closeLightbox, downloadLightboxAttachment } = lightbox
  const { deleteMessage, toggleReaction } = mutations

  return (
    <>
    <Modal
      open={Boolean(reactionDetailsMessage && selectedReaction)}
      onClose={() => setReactionDetails(null)}
      title="Who reacted"
      subtitle="See everyone behind each reaction and manage your own."
      size="md"
    >
      {reactionDetailsMessage && selectedReaction && (() => {
        const selectedDisplay = REACTIONS_BY_VALUE.get(selectedReaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
        const SelectedIcon = selectedDisplay.Icon
        return (
          <div>
            <div role="tablist" aria-label="Message reactions" className="flex gap-2 overflow-x-auto pb-4">
              {reactionDetailsMessage.reactions.map((reaction) => {
                const display = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
                const Icon = display.Icon
                const active = reaction.emoji === selectedReaction.emoji
                return (
                  <TabButton
                    key={reaction.emoji}
                    asTab
                    selected={active}
                    aria-label={`${display.label}, ${reaction.count}`}
                    onClick={() => setReactionDetails({ messageId: reactionDetailsMessage.id, emoji: reaction.emoji })}
                    className="tabular-nums"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {reaction.count}
                  </TabButton>
                )
              })}
            </div>
            <div className="flex min-h-12 items-center gap-2 border-b border-slate-200">
              <SelectedIcon className="h-4 w-4 text-ink-secondary" />
              <p className="flex-1 text-sm font-semibold text-slate-900">{selectedDisplay.label}</p>
              <span className="text-xs font-semibold tabular-nums text-slate-500">{selectedReaction.count}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {selectedReaction.users.map((person) => (
                <div key={person.id} className="flex min-h-14 items-center gap-3 py-2">
                  <Avatar name={person.full_name} src={person.avatar_url} />
                  <span className="min-w-0 truncate text-sm font-medium text-slate-800">{person.full_name}</span>
                </div>
              ))}
            </div>
            <Button
              variant={selectedReaction.reacted ? 'secondary' : 'primary'}
              size="lg"
              fullWidth
              onClick={() => void toggleReaction(reactionDetailsMessage, selectedReaction.emoji)}
              className="mt-5"
            >
              <SelectedIcon className="h-4 w-4" />
              {selectedReaction.reacted ? `Remove your ${selectedDisplay.label.toLowerCase()}` : `React with ${selectedDisplay.label.toLowerCase()}`}
            </Button>
          </div>
        )
      })()}
    </Modal>
    <Modal
      open={showWorkspaceSwitcher}
      onClose={() => setShowWorkspaceSwitcher(false)}
      title="Switch workspace"
      subtitle="Move between cohorts, communities, channels, and direct messages."
      size="lg"
    >
      <div className="space-y-3">
        {sortedWorkspaceCards.map(({ workspace, channelCount, dmCount, unreadChannelCount, unreadDmCount, unreadCount }) => {
          const active = workspace.id === selectedWorkspaceId

          return (
            <div
              key={workspace.id}
              className={`flex items-stretch gap-2 rounded-2xl border ${active ? 'border-line-strong' : unreadCount > 0 ? 'border-line-strong' : 'border-line'} bg-surface-raised`}
            >
              <RowButton
                selected={active}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  selectWorkspace(workspace.id)
                  setShowWorkspaceSwitcher(false)
                }}
                className="group flex flex-1 items-center gap-4 rounded-2xl px-4 py-4"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${active ? 'bg-slate-300 text-ink' : 'bg-slate-200 text-ink-secondary'}`} aria-hidden="true">
                  {channelInitials(workspace.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-ink">{workspace.name}</span>
                    <CountBadge count={unreadCount} label="unread" />
                    {active && <Badge icon={<Check className="h-3 w-3" aria-hidden="true" />}>Current</Badge>}
                    <Badge tone={workspace.workspace_type === 'community' ? 'neutral' : 'info'}>{workspace.workspace_type === 'community' ? 'Community' : 'Cohort'}</Badge>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {workspace.member_count} {workspace.member_count === 1 ? 'member' : 'members'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                      {channelCount} {channelCount === 1 ? 'channel' : 'channels'}
                      {unreadChannelCount > 0 && <span className="font-semibold text-ink">· {unreadChannelCount} unread</span>}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      {dmCount} DM {dmCount === 1 ? 'conversation' : 'conversations'}
                      {unreadDmCount > 0 && <span className="font-semibold text-ink">· {unreadDmCount} unread</span>}
                    </span>
                  </span>
                  {workspace.description && (
                    <span className="mt-2 block line-clamp-2 text-xs leading-5 text-ink-muted">{workspace.description}</span>
                  )}
                </span>
              </RowButton>
              {unreadCount > 0 && (
                <div className="flex shrink-0 items-center pr-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      markWorkspaceRead(workspace.id).catch(() => {
                        toast.error('Failed to mark workspace as read')
                      })
                    }}
                  >
                    <CheckCheck className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Mark read</span>
                    <span className="sr-only">{` ${workspace.name}`}</span>
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>

    {isAdmin && (
      <Modal
        open={showWorkspaceForm}
        onClose={() => {
          setShowWorkspaceForm(false)
          setWorkspaceError('')
        }}
        title="Create workspace"
        subtitle="Use this for alumni, staff groups, or other shared communities."
        size="lg"
      >
        <form onSubmit={handleCreateWorkspace} className="space-y-4">
          {workspaceError && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
              {workspaceError}
            </div>
          )}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Workspace name</label>
            <input
              value={workspaceForm.name}
              onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Workspace name"
              className="app-control w-full"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={workspaceForm.description}
              onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="What is this workspace for?"
              rows={3}
              className="app-control w-full resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowWorkspaceForm(false)
                setWorkspaceError('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={creatingWorkspace || !workspaceForm.name.trim()}
            >
              {creatingWorkspace ? 'Creating…' : 'Create workspace'}
            </Button>
          </div>
        </form>
      </Modal>
    )}

    {workspaceDetail && (
      <Modal
        open={showWorkspaceMembers}
        onClose={() => {
          setShowWorkspaceMembers(false)
          setWorkspaceError('')
        }}
        title={`${workspaceDetail.name} members`}
        subtitle={workspaceDetail.workspace_type === 'community'
          ? 'Manage who can access this workspace.'
          : 'This workspace follows active cohort enrollment.'}
        size="lg"
      >
        <div className="space-y-4">
          {workspaceError && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
              {workspaceError}
            </div>
          )}
          {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && (
            <form onSubmit={handleAddWorkspaceMember} className="flex flex-col gap-2 sm:flex-row">
              <select
                value={memberToAddId}
                onChange={(event) => setMemberToAddId(event.target.value)}
                className="app-control min-w-0 flex-1"
              >
                <option value="">Add a member</option>
                {memberCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.full_name} ({candidate.email || candidate.role})</option>
                ))}
              </select>
              <Button
                variant="primary"
                type="submit"
                disabled={!memberToAddId}
              >
                Add member
              </Button>
            </form>
          )}
          <div className="space-y-2">
            {workspaceDetail.members.length === 0 ? (
              <p className="text-sm text-slate-500">No members listed yet.</p>
            ) : workspaceDetail.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <div className="min-w-0">
                  <WorkspaceMemberIdentity member={member} isStaff={isStaff} />
                  <p className="truncate text-xs text-slate-500">
                    {member.role}
                    {member.membership_role && ` · ${member.membership_role}`}
                  </p>
                </div>
                {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && member.membership_role !== 'manager' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Remove ${member.full_name}, ${member.email || member.role}`}
                    onClick={() => handleRemoveWorkspaceMember(member.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Modal>
    )}

    {canManageChannels && (
      <Modal
        open={showChannelForm}
        onClose={() => {
          setShowChannelForm(false)
          setChannelError('')
        }}
        title="Create channel"
        subtitle="Add a shared space inside this workspace."
        size="lg"
      >
        <form onSubmit={handleCreateChannel} className="space-y-4">
          {channelError && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
              {channelError}
            </div>
          )}
          <select
            value={channelForm.workspace_id}
            onChange={(event) => setChannelForm((prev) => ({ ...prev, workspace_id: event.target.value }))}
            className="app-control w-full"
          >
            {workspaces.filter((workspace) => isAdmin || workspace.workspace_type === 'cohort').map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
            ))}
          </select>
          <input
            value={channelForm.name}
            onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Channel name"
            className="app-control w-full"
          />
          <textarea
            value={channelForm.description}
            onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="What is this channel for?"
            rows={3}
            className="app-control w-full resize-none"
          />
          <select
            value={channelForm.visibility}
            onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
            className="app-control w-full"
          >
            <option value="cohort">Students and staff</option>
            <option value="staff_only">Staff only</option>
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowChannelForm(false)
                setChannelError('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={creatingChannel || !channelForm.workspace_id || !channelForm.name.trim()}
            >
              {creatingChannel ? 'Creating…' : 'Create channel'}
            </Button>
          </div>
        </form>
      </Modal>
    )}

    <Modal
      open={Boolean(messagePendingDelete)}
      onClose={() => setMessagePendingDelete(null)}
      title="Delete message?"
      subtitle="This removes the message for everyone in the conversation."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setMessagePendingDelete(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!messagePendingDelete) return
              void deleteMessage(messagePendingDelete)
              setMessagePendingDelete(null)
            }}
          >
            Delete message
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          This action cannot be undone.
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {messagePendingDelete ? preview(messagePendingDelete.body) || 'Attachment-only message' : ''}
        </div>
      </div>
    </Modal>

    <Modal
      open={Boolean(mobileActionsMessage)}
      onClose={() => setMobileActionsMessageId(null)}
      title="Message actions"
      subtitle={mobileActionsMessage ? `${mobileActionsMessage.author.full_name} · ${formatTime(mobileActionsMessage.created_at)}` : undefined}
      size="md"
    >
      <MessageActionsSheet isStaff={isStaff} conversation={conversation} overlays={overlays} replyToMessage={replyToMessage} mutations={mutations} />
    </Modal>

    <Modal
      open={showDmForm}
      onClose={() => setShowDmForm(false)}
      title="Start direct message"
      subtitle="Pick someone in this workspace."
      size="md"
    >
      <form onSubmit={handleCreateDm} className="space-y-4">
        <select
          value={dmUserId}
          onChange={(event) => setDmUserId(event.target.value)}
          className="app-control w-full"
        >
          {availableUsers.map((availableUser) => (
            <option key={availableUser.id} value={availableUser.id}>
              {recipientLabel(availableUser, availableUsers, selectedWorkspace?.name)}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => setShowDmForm(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!selectedWorkspaceId || !dmUserId}
          >
            Start direct message
          </Button>
        </div>
      </form>
    </Modal>

    {authorContext && <MessageAuthorContext author={authorContext} staff={isStaff} workspaceReturnContext={conversationReturnContext} cohortId={selected?.cohort_id || undefined} source={authorContext.id === selectedDmStudent?.id ? sourceRecord || undefined : undefined} onClose={() => setAuthorContext(null)} />}
    {lightboxAttachment?.url && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Image preview: ${lightboxAttachment.filename}`}
        onTouchStart={(event) => {
          lightboxTouchStartX.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          if (lightboxTouchStartX.current === null) return
          const endX = event.changedTouches[0]?.clientX
          if (endX === undefined) {
            lightboxTouchStartX.current = null
            return
          }
          const delta = endX - lightboxTouchStartX.current
          lightboxTouchStartX.current = null
          if (Math.abs(delta) < 60) return
          if (delta < 0) showNextLightboxImage()
          else showPreviousLightboxImage()
        }}
      >
        <IconButton label="Close image preview" onClick={closeLightbox} className="absolute right-4 top-4 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
          <X className="h-5 w-5" />
        </IconButton>
        {lightboxAttachments.length > 1 && (
          <>
            <IconButton label="Previous image" onClick={showPreviousLightboxImage} disabled={lightboxIndex === 0} className="absolute left-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
              <ChevronLeft className="h-6 w-6" />
            </IconButton>
            <IconButton label="Next image" onClick={showNextLightboxImage} disabled={lightboxIndex === lightboxAttachments.length - 1} className="absolute right-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
              <ChevronRight className="h-6 w-6" />
            </IconButton>
          </>
        )}
        <div className="max-h-full max-w-5xl overflow-hidden rounded-2xl bg-surface-raised shadow-overlay">
          <img src={lightboxAttachment.url} alt={lightboxAttachment.filename} className="max-h-[80vh] w-full object-contain" />
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-sm text-slate-700">
            <div className="min-w-0">
              <div className="truncate font-medium">{lightboxAttachment.filename}</div>
              <div className="tabular-nums text-slate-500">
                {lightboxAttachments.length > 1 && `${lightboxIndex + 1} of ${lightboxAttachments.length} · `}
                {formatFileSize(lightboxAttachment.byte_size)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AnchorButton
                href={lightboxAttachment.url}
                target="_blank"
                rel="noreferrer"
                size="sm"
              >
                Open
              </AnchorButton>
              <Button variant="secondary" size="sm" onClick={downloadLightboxAttachment}>
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
