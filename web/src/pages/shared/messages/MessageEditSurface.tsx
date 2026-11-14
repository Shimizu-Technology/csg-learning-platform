import { useRef, useState } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../../components/shared/MarkdownEditor';
import { Button } from '../../../components/ui/Button';
import { MESSAGE_BODY_LIMIT, messageCharacterCount } from '../../../lib/messageComposerState';
import { normalizeMessageMarkdown } from '../../../lib/messageFormat';
import { FormattedMessage } from './FormattedMessage';

export function MessageEditSurface({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null)
  const [value, setValue] = useState(initialValue)
  const normalizedValue = normalizeMessageMarkdown(value)
  const characterCount = messageCharacterCount(normalizedValue)
  const canSave = normalizedValue.length > 0 && characterCount <= MESSAGE_BODY_LIMIT
  const save = () => {
    const body = editorRef.current?.getMarkdown() ?? value
    const normalized = normalizeMessageMarkdown(body)
    if (!normalized || messageCharacterCount(normalized) > MESSAGE_BODY_LIMIT) return
    onSave(body)
  }

  return (
    <div className="mt-2 space-y-2">
      <MarkdownEditor
        ref={editorRef}
        variant="composer"
        label="Edit message"
        defaultValue={initialValue}
        onChange={setValue}
        onSubmit={save}
        onEscape={onCancel}
        submitVerb="save"
        underlineShortcut
        autoFocus
        maxHeight={448}
        renderPreview={(markdown) => <FormattedMessage body={markdown} />}
        hintStart={characterCount > MESSAGE_BODY_LIMIT ? (
          <span className="font-semibold tabular-nums text-danger-700">{characterCount.toLocaleString()} / {MESSAGE_BODY_LIMIT.toLocaleString()} characters</span>
        ) : null}
      />
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={!canSave}>Save changes</Button>
      </div>
    </div>
  )
}
