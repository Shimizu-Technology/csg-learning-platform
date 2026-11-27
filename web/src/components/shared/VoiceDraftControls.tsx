import { AlertCircle, Loader2, Mic, RotateCcw, Square, X } from 'lucide-react'
import type { VoiceDraftState } from '../../hooks/useVoiceDraft'
import { formatVoiceDuration } from '../../lib/voiceDraft'
import { Button } from '../ui/Button'

export interface VoiceDraftButtonProps {
  state: VoiceDraftState
  supported?: boolean
  disabled?: boolean
  label?: string
  showLabel?: boolean
  compact?: boolean
  onClick: () => void
  className?: string
}

export function VoiceDraftButton({
  state,
  supported = true,
  disabled = false,
  label = 'Dictate a draft',
  showLabel = false,
  compact = false,
  onClick,
  className = '',
}: VoiceDraftButtonProps) {
  if (!supported) return null
  const busy = state === 'preparing' || state === 'recording' || state === 'transcribing'
  const isDisabled = disabled || busy

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (inserts editable text; never sends automatically)`}
      aria-busy={busy || undefined}
      disabled={isDisabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 ${
        showLabel
          ? 'min-h-11 border border-line-strong bg-surface-raised px-3 text-sm text-ink-secondary hover:bg-surface-sunken hover:text-ink lg:min-h-9'
          : compact
            ? 'h-11 w-11 text-ink-secondary hover:bg-surface-sunken hover:text-ink'
            : 'h-11 w-11 border border-line-strong bg-surface-raised text-ink-secondary hover:bg-surface-sunken hover:text-ink'
      } ${state === 'recording' ? 'text-danger-ink' : ''} ${className}`}
    >
      <Mic className="h-4 w-4 shrink-0" aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </button>
  )
}

export interface VoiceDraftPanelProps {
  state: VoiceDraftState
  durationMillis: number
  maxDurationSeconds?: number
  error: string | null
  notice: string | null
  hasReview: boolean
  hasRecording?: boolean
  onStop: () => void
  onCancel: () => void
  onRetry: () => void
  onRecordAgain?: () => void
  onRestore: () => void
  onDismiss: () => void
  className?: string
}

export function VoiceDraftPanel({
  state,
  durationMillis,
  maxDurationSeconds = 300,
  error,
  notice,
  hasReview,
  hasRecording = false,
  onStop,
  onCancel,
  onRetry,
  onRecordAgain,
  onRestore,
  onDismiss,
  className = '',
}: VoiceDraftPanelProps) {
  if (state === 'idle') return null

  if (state === 'preparing') {
    return (
      <div
        role="status"
        aria-live="polite"
        data-voice-panel="preparing"
        className={`flex items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 ${className}`}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-secondary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Getting the microphone ready…</p>
          <p className="text-xs text-ink-secondary">
            Audio is temporarily processed for transcription and discarded. Your typed draft stays where it is.
          </p>
        </div>
        <Button variant="quiet" size="sm" aria-label="Cancel voice draft" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Cancel</span>
        </Button>
      </div>
    )
  }

  if (state === 'recording') {
    const seconds = Math.min(maxDurationSeconds, Math.floor(durationMillis / 1_000))
    const remaining = Math.max(0, maxDurationSeconds - seconds)
    return (
      <div
        role="status"
        aria-live="polite"
        data-voice-panel="recording"
        className={`space-y-2.5 rounded-2xl border border-primary-soft-line bg-primary-soft px-4 py-3 ${className}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger-solid motion-safe:animate-pulse" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-ink">Listening…</p>
              <p className="text-xs font-medium tabular-nums text-ink-secondary">
                {formatVoiceDuration(seconds)} / {formatVoiceDuration(maxDurationSeconds)}
                {remaining <= 30 ? ` · ${remaining}s left` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Cancel recording" onClick={onCancel}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
            <Button variant="primary" size="sm" aria-label="Stop and transcribe recording" onClick={onStop}>
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              Stop &amp; transcribe
            </Button>
          </div>
        </div>
        <p className="text-xs text-ink-secondary">
          Speak naturally. Click stop when your draft is finished. Nothing is sent automatically.
        </p>
      </div>
    )
  }

  if (state === 'transcribing') {
    return (
      <div
        role="status"
        aria-live="polite"
        data-voice-panel="transcribing"
        className={`flex items-center gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 ${className}`}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary-ink" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Turning speech into a draft…</p>
          <p className="text-xs text-ink-secondary">Longer recordings can take a moment. Your typed draft is safe.</p>
        </div>
        <Button variant="quiet" size="sm" aria-label="Cancel transcription" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Cancel</span>
        </Button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div
        role="alert"
        aria-live="polite"
        data-voice-panel="error"
        className={`space-y-3 rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 ${className}`}
      >
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold text-danger-ink">Voice draft needs attention</p>
            <p className="text-xs text-ink">{error}</p>
            {hasRecording && (
              <p className="text-xs font-medium text-ink-secondary">Your recording is saved for this retry.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasRecording && (
            <Button variant="primary" size="sm" aria-label="Retry transcription" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Retry transcription
            </Button>
          )}
          {onRecordAgain && (
            <Button variant="secondary" size="sm" aria-label="Record again" onClick={onRecordAgain}>
              <Mic className="h-4 w-4" aria-hidden="true" />
              Record again
            </Button>
          )}
          <Button variant="quiet" size="sm" aria-label="Dismiss voice draft error" onClick={onCancel}>
            <X className="h-4 w-4" aria-hidden="true" />
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  if (state === 'review' && hasReview) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-voice-panel="review"
        className={`space-y-2.5 rounded-2xl border border-primary-soft-line bg-primary-soft px-4 py-3 ${className}`}
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-ink">Review your voice draft</p>
          <p className="text-xs text-ink-secondary">{notice}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Use raw transcript" onClick={onRestore}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Use raw transcript
          </Button>
          {onRecordAgain && (
            <Button variant="secondary" size="sm" aria-label="Record again" onClick={onRecordAgain}>
              <Mic className="h-4 w-4" aria-hidden="true" />
              Record again
            </Button>
          )}
          <Button variant="quiet" size="sm" aria-label="Dismiss review" onClick={onDismiss}>
            <X className="h-4 w-4" aria-hidden="true" />
            Dismiss review
          </Button>
        </div>
      </div>
    )
  }

  return null
}
