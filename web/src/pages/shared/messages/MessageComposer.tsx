import { type JSONContent } from '@tiptap/core';
import { AtSign, Paperclip, Send, Users } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MarkdownEditor, ToolbarButton, isComposingKey, markdownToEditorDoc, type MarkdownEditorHandle } from '../../../components/shared/MarkdownEditor';
import { Avatar } from '../../../components/ui/Avatar';
import { Button } from '../../../components/ui/Button';
import { RowButton } from '../../../components/ui/RowButton';
import { MESSAGE_BODY_LIMIT, messageCharacterCount, readComposerDraft, safeLocalStorage, writeComposerDraft } from '../../../lib/messageComposerState';
import { normalizeMessageMarkdown } from '../../../lib/messageFormat';
import { matchingPeople, personContext } from '../../../lib/person-context';
import { FormattedMessage } from './FormattedMessage';
import { CHANNEL_MENTION_ALIASES } from './helpers';
import { MentionHighlightExtension, resolveMentionedUserIds, stripMentionLabel } from './mentions';
import { type MentionPattern, type MentionSuggestion, type MentionableUser } from './types';

/**
 * Composer drafts changed since they were last saved, by draft key. Crossing
 * the 1024px breakpoint with a thread open swaps one composer placement for
 * another with the same key in a single commit: the new one mounts before the
 * old one's unmount saves to localStorage, so it takes the latest text from here.
 */
const unsavedComposerDrafts = new Map<string, { body: string; content: JSONContent | null }>()

export type MessageComposerSend = { body: string; mentionUserIds: number[] }

export type MessageComposerHandle = { focus: () => void; insertMarkdown: (markdown: string) => void }

/**
 * The message composer. It owns the editor, the draft, @mentions and the
 * character count, so typing re-renders this component, not the Messages
 * page (W2 2.2b). The page hears about typing through `onTyping`, which
 * doesn't set page state.
 */
export const MessageComposer = memo(forwardRef<MessageComposerHandle, {
  draftKey: string | null
  label: string
  placeholder: string
  mentionableUsers: MentionableUser[]
  mentionPatterns: MentionPattern[]
  includeChannelMentions: boolean
  workspaceName?: string
  hasAttachments: boolean
  sending: boolean
  inThreadPanel: boolean
  onSend: (send: MessageComposerSend) => boolean
  onTyping: (hasContent: boolean) => void
  onFiles: (files: File[]) => void
  onAttach: () => void
  onEditLastMessage?: () => void
}>(function MessageComposer({
  draftKey,
  label,
  placeholder,
  mentionableUsers,
  mentionPatterns,
  includeChannelMentions,
  workspaceName,
  hasAttachments,
  sending,
  inThreadPanel,
  onSend,
  onTyping,
  onFiles,
  onAttach,
  onEditLastMessage,
}, ref) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const draftKeyRef = useRef(draftKey)
  const [initialDraft] = useState(() => (draftKey
    ? unsavedComposerDrafts.get(draftKey) ?? readComposerDraft(draftKey, safeLocalStorage())
    : null))
  const bodyRef = useRef(initialDraft?.body || '')
  /**
   * The draft as of the last change. Saving reads this, not the editor: when
   * the composer unmounts, the editor's handle is gone before the save runs.
   */
  const draftRef = useRef<{ body: string; content: JSONContent | null }>({ body: initialDraft?.body || '', content: initialDraft?.content || null })
  /** Set while the composer unmounts, so the editor's last write only updates the draft. */
  const unmountingRef = useRef(false)
  const [hasContent, setHasContent] = useState(Boolean(normalizeMessageMarkdown(bodyRef.current)))
  const [characterCount, setCharacterCount] = useState(() => {
    const count = messageCharacterCount(normalizeMessageMarkdown(bodyRef.current))
    return count >= 4_500 ? count : 0
  })
  const [mentionToken, setMentionToken] = useState<string | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const selectedMentionIdsRef = useRef<number[]>([])
  const draftTimerRef = useRef<number | null>(null)
  const loadingDraftRef = useRef(false)
  const mentionPatternsRef = useRef(mentionPatterns)
  const onTypingRef = useRef(onTyping)
  onTypingRef.current = onTyping

  useLayoutEffect(() => {
    mentionPatternsRef.current = mentionPatterns
  }, [mentionPatterns])

  const extensions = useMemo(() => [
    MentionHighlightExtension.configure({ getPatterns: () => mentionPatternsRef.current }),
  ], [])

  const saveDraftNow = useCallback((key: string | null) => {
    // While the editor is mounted, write out its pending keystrokes into the snapshot first.
    // That write's onChange schedules an autosave under the current key, so cancel timers after it,
    // never before: a timer left over from a conversation switch would save the next draft here.
    editorRef.current?.getMarkdown()
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    if (!key) return
    const draft = draftRef.current
    writeComposerDraft(key, { version: 1, body: draft.body, content: draft.content ?? markdownToEditorDoc(draft.body).doc }, safeLocalStorage())
    if (unsavedComposerDrafts.get(key) === draft) unsavedComposerDrafts.delete(key)
  }, [])

  const updateCounts = useCallback((body: string) => {
    const normalized = normalizeMessageMarkdown(body)
    setHasContent(Boolean(normalized))
    // Only the last 500 characters before the limit show a count, so typing elsewhere doesn't re-render.
    const count = messageCharacterCount(normalized)
    setCharacterCount(count >= 4_500 ? count : 0)
    return Boolean(normalized)
  }, [])

  // Another conversation or thread: keep this draft, open that one.
  useEffect(() => {
    const previous = draftKeyRef.current
    if (previous === draftKey) return
    saveDraftNow(previous)
    draftKeyRef.current = draftKey
    onTypingRef.current(false)
    const draft = draftKey
      ? unsavedComposerDrafts.get(draftKey) ?? readComposerDraft(draftKey, safeLocalStorage())
      : null
    loadingDraftRef.current = true
    editorRef.current?.setMarkdown(draft?.body || '', draft?.content || null)
    loadingDraftRef.current = false
    bodyRef.current = draft?.body || ''
    draftRef.current = { body: draft?.body || '', content: draft?.content || null }
    selectedMentionIdsRef.current = []
    setMentionToken(null)
    updateCounts(bodyRef.current)
  }, [draftKey, saveDraftNow, updateCounts])

  // Parent layout cleanups run before the editor's, which writes out its last keystrokes.
  useLayoutEffect(() => {
    unmountingRef.current = false
    return () => { unmountingRef.current = true }
  }, [])

  // A composer that replaced another with the same draft (a placement change at the
  // breakpoint) mounts after the old editor wrote out its last keystrokes, but before
  // they were saved: take them from the shared unsaved drafts.
  useLayoutEffect(() => {
    const key = draftKeyRef.current
    const unsaved = key ? unsavedComposerDrafts.get(key) : undefined
    if (!unsaved || unsaved.body === bodyRef.current) return
    loadingDraftRef.current = true
    editorRef.current?.setMarkdown(unsaved.body, unsaved.content)
    loadingDraftRef.current = false
    bodyRef.current = unsaved.body
    draftRef.current = unsaved
    updateCounts(unsaved.body)
  }, [updateCounts])

  useEffect(() => {
    // Closing or reloading the tab doesn't unmount React components: save on pagehide too.
    const save = () => saveDraftNow(draftKeyRef.current)
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [saveDraftNow])

  const handleChange = useCallback((body: string, richContent?: JSONContent) => {
    bodyRef.current = body
    if (loadingDraftRef.current) return
    draftRef.current = { body, content: richContent ?? null }
    if (draftKeyRef.current) unsavedComposerDrafts.set(draftKeyRef.current, draftRef.current)
    if (unmountingRef.current) return
    const content = updateCounts(body)
    onTypingRef.current(content)
    const key = draftKeyRef.current
    if (!key || typeof window === 'undefined') return
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null
      saveDraftNow(key)
    }, 250)
  }, [saveDraftNow, updateCounts])

  const handleCaretText = useCallback((text: string) => {
    const token = text.match(/(^|\s)@([^\s@]*)$/)?.[2] ?? null
    setMentionToken((current) => {
      if (current !== token) setActiveMentionIndex(0)
      return token
    })
  }, [])

  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    if (mentionToken === null) return []
    const normalized = stripMentionLabel(mentionToken)
    const suggestions: MentionSuggestion[] = includeChannelMentions
      ? CHANNEL_MENTION_ALIASES
        .filter((mention) => stripMentionLabel(mention.label).startsWith(normalized))
        .map((mention) => ({ id: mention.label, label: mention.label, subtitle: mention.subtitle, kind: 'channel' as const }))
      : []
    return [
      ...suggestions,
      ...matchingPeople(mentionableUsers, normalized, workspaceName).map((person) => ({
        id: String(person.id),
        label: `@${person.full_name}`,
        subtitle: personContext(person, mentionableUsers, workspaceName),
        kind: 'user' as const,
        avatarUrl: person.avatar_url,
      })),
    ]
  }, [includeChannelMentions, mentionToken, mentionableUsers, workspaceName])

  const selectMention = useCallback((mention: MentionSuggestion) => {
    const editor = editorRef.current
    if (!editor) return
    if (mention.kind === 'user' && !selectedMentionIdsRef.current.includes(Number(mention.id))) {
      selectedMentionIdsRef.current = [...selectedMentionIdsRef.current, Number(mention.id)]
    }
    // Only the active @token (the one the menu was opened for), never earlier mentions or text.
    const match = editor.getTextBeforeCaret().match(/(^|\s)(@[^\s@]*)$/)
    if (match) editor.replaceTextBeforeCaret(match[2].length, `${mention.label} `)
    else editor.insertText(`${mention.label} `)
    setMentionToken(null)
  }, [])

  const suggestionsRef = useRef({ mentionSuggestions, activeMentionIndex })
  suggestionsRef.current = { mentionSuggestions, activeMentionIndex }
  const onEditLastMessageRef = useRef(onEditLastMessage)
  onEditLastMessageRef.current = onEditLastMessage
  const hasAttachmentsRef = useRef(hasAttachments)
  hasAttachmentsRef.current = hasAttachments

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    const { mentionSuggestions: suggestions, activeMentionIndex: index } = suggestionsRef.current
    // Enter or Tab that confirms an IME composition (Japanese, Chinese, Korean…) isn't a mention pick.
    if (isComposingKey(event)) return false
    if (suggestions.length === 0) {
      // Slack/Discord shortcut: Up arrow in an empty composer (no text or pending files) opens inline edit on your last editable message.
      if (
        event.key === 'ArrowUp'
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey
        && !event.ctrlKey
        && !hasAttachmentsRef.current
        && !bodyRef.current.trim()
        && onEditLastMessageRef.current
      ) {
        const currentText = editorRef.current?.getMarkdown() ?? bodyRef.current
        if (!currentText.trim()) {
          event.preventDefault()
          onEditLastMessageRef.current()
          return true
        }
      }
      return false
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveMentionIndex((current) => (current + step + suggestions.length) % suggestions.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      selectMention(suggestions[index] || suggestions[0])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMentionToken(null)
      return true
    }
    return false
  }, [selectMention])

  const overLimit = characterCount > MESSAGE_BODY_LIMIT
  /**
   * Send looks like a button at all times (U-4.11): it's only unavailable when
   * there's nothing to send or the message is too long, and it says why.
   */
  const sendBlockedReason = overLimit
    ? `Shorten your message to ${MESSAGE_BODY_LIMIT.toLocaleString()} characters or fewer to send it.`
    : !hasContent && !hasAttachments ? 'Write a message or attach a file to send.' : null
  const sendReasonId = useId()

  const submit = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const body = normalizeMessageMarkdown(editor.getMarkdown())
    if (!body && !hasAttachments) return
    if (messageCharacterCount(body) > MESSAGE_BODY_LIMIT) return
    const mentionUserIds = resolveMentionedUserIds(body, mentionableUsers, selectedMentionIdsRef.current)
    if (!onSend({ body, mentionUserIds })) return
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    loadingDraftRef.current = true
    editor.clear()
    loadingDraftRef.current = false
    bodyRef.current = ''
    draftRef.current = { body: '', content: null }
    selectedMentionIdsRef.current = []
    setMentionToken(null)
    updateCounts('')
    onTypingRef.current(false)
    if (draftKeyRef.current) unsavedComposerDrafts.delete(draftKeyRef.current)
    if (draftKeyRef.current) writeComposerDraft(draftKeyRef.current, null, safeLocalStorage())
  }, [hasAttachments, mentionableUsers, onSend, updateCounts])

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertMarkdown: (markdown: string) => editorRef.current?.insertMarkdown(markdown),
  }), [])

  const renderPreview = useCallback((markdown: string) => <FormattedMessage body={markdown} mentionPatterns={mentionPatternsRef.current} />, [])

  return (
    <div className="relative">
      <MarkdownEditor
        ref={editorRef}
        variant="composer"
        label={label}
        placeholder={placeholder}
        defaultValue={initialDraft?.body || ''}
        defaultRichContent={initialDraft?.content || null}
        onChange={handleChange}
        onCaretText={handleCaretText}
        onKeyDown={handleKeyDown}
        onSubmit={submit}
        onFiles={onFiles}
        renderPreview={renderPreview}
        extensions={extensions}
        underlineShortcut
        compactToolbar={inThreadPanel}
        maxHeight={inThreadPanel ? 220 : 280}
        className="shadow-raised sm:rounded-2xl"
        toolbarStart={(
          <ToolbarButton label="Attach files" compact onClick={onAttach}>
            <Paperclip className="h-4 w-4" aria-hidden="true" />
          </ToolbarButton>
        )}
        toolbarEnd={(
          <ToolbarButton label="Mention someone" shortcut="@" compact onClick={() => editorRef.current?.insertText('@')}>
            <AtSign className="h-4 w-4" aria-hidden="true" />
          </ToolbarButton>
        )}
        hintStart={characterCount > 0 ? (
          <span className={`tabular-nums ${overLimit ? 'font-semibold text-danger-ink' : ''}`} aria-live="polite">
            {characterCount.toLocaleString()} / {MESSAGE_BODY_LIMIT.toLocaleString()} characters
          </span>
        ) : null}
        submitSlot={(
          <>
            <Button
              type="button"
              size="sm"
              variant={sendBlockedReason ? 'secondary' : 'primary'}
              aria-disabled={sendBlockedReason ? true : undefined}
              aria-describedby={sendBlockedReason ? sendReasonId : undefined}
              aria-busy={sending || undefined}
              title={sendBlockedReason || undefined}
              data-send-state={sendBlockedReason ? 'blocked' : sending ? 'sending' : 'ready'}
              onClick={() => {
                // Nothing to send yet: put the cursor where the message goes instead.
                if (sendBlockedReason) editorRef.current?.focus()
                else submit()
              }}
              className={`h-11 w-11 shrink-0 px-0 sm:h-9 sm:min-h-9 sm:w-auto sm:px-3 ${sendBlockedReason ? 'border-line-strong! bg-surface-sunken! text-ink-secondary! shadow-none! hover:bg-surface-sunken! aria-disabled:pointer-events-auto! aria-disabled:opacity-100! cursor-not-allowed' : ''}`}
              aria-label={sending ? 'Sending message' : 'Send message'}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Send</span>
            </Button>
            {sendBlockedReason && <span id={sendReasonId} className="sr-only">{sendBlockedReason}</span>}
          </>
        )}
      />
      {mentionSuggestions.length > 0 && (
        <div className={`absolute bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-overlay ${inThreadPanel ? 'left-2 right-2' : 'left-3 w-72'}`}>
          <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink-muted">Mention someone</div>
          {mentionSuggestions.map((mention, index) => (
            <RowButton
              key={mention.id}
              selected={index === activeMentionIndex}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectMention(mention)}
              className="flex w-full items-center gap-3 px-3 py-2 text-sm"
            >
              {mention.kind === 'channel' ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-info-line bg-info-soft text-info-ink"><Users className="h-4 w-4" aria-hidden="true" /></span>
              ) : (
                <Avatar name={mention.label.replace(/^@/, '')} src={mention.avatarUrl} size="sm" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{mention.label}</span>
                <span className="block truncate text-xs text-ink-muted">{mention.subtitle}</span>
              </span>
            </RowButton>
          ))}
        </div>
      )}
    </div>
  )
}))
