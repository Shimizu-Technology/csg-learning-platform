import { useCallback, useEffect, useRef, useState } from 'react'
import { captureProductEvent, durationBucket, latencyBucket, type VoiceSurface } from '../lib/analytics'
import { api } from '../lib/api'
import {
  insertVoiceDraft,
  pickSupportedAudioMimeType,
  restoreRawVoiceDraft,
  voiceDraftWithinLimit,
  voiceEditDistanceBucket,
  voiceRecordingFilename,
  type VoiceDraftReview,
} from '../lib/voiceDraft'

export const MAX_VOICE_RECORDING_SECONDS = 5 * 60
export const MAX_VOICE_RECORDING_BYTES = 6 * 1024 * 1024

export type VoiceDraftState = 'idle' | 'preparing' | 'recording' | 'transcribing' | 'review' | 'error'

interface SavedRecording {
  blob: Blob
  filename: string
  durationSeconds: number
}

export interface UseVoiceDraftOptions {
  surface: VoiceSurface
  getDraft: () => string
  getSelection?: () => { start: number; end: number }
  disabled?: boolean
  maxDraftLength?: number
  onDraftChange: (value: string, selection: { start: number; end: number }) => void
}

export function isVoiceRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (window.isSecureContext === false) return false
  return Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined',
  )
}

async function queryMicrophonePermissionState(): Promise<'unknown' | 'granted' | 'denied'> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      // Best-effort track cleanup.
    }
  }
}

export function useVoiceDraft({
  surface,
  getDraft,
  getSelection,
  disabled = false,
  maxDraftLength,
  onDraftChange,
}: UseVoiceDraftOptions) {
  const supported = isVoiceRecordingSupported()
  const [state, setState] = useState<VoiceDraftState>('idle')
  const [review, setReview] = useState<VoiceDraftReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [durationMillis, setDurationMillis] = useState(0)
  const [hasRecording, setHasRecording] = useState(false)

  const stateRef = useRef(state)
  const mountedRef = useRef(true)
  const attemptRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef('')
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recordingRef = useRef<SavedRecording | null>(null)

  const getDraftRef = useRef(getDraft)
  const getSelectionRef = useRef(getSelection)
  const onDraftChangeRef = useRef(onDraftChange)
  const maxDraftLengthRef = useRef(maxDraftLength)

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { getDraftRef.current = getDraft }, [getDraft])
  useEffect(() => { getSelectionRef.current = getSelection }, [getSelection])
  useEffect(() => { onDraftChangeRef.current = onDraftChange }, [onDraftChange])
  useEffect(() => { maxDraftLengthRef.current = maxDraftLength }, [maxDraftLength])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releaseRecorderAndStream = useCallback(() => {
    clearTimer()
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        // Ignore stop errors during teardown.
      }
    }
    const stream = streamRef.current
    streamRef.current = null
    stopMediaStream(stream)
    chunksRef.current = []
  }, [clearTimer])

  const discardSavedRecording = useCallback(() => {
    recordingRef.current = null
    setHasRecording(false)
  }, [])

  const transcribe = useCallback(async (recording: SavedRecording) => {
    setState('transcribing')
    setError(null)
    setNotice(null)

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()

    try {
      const result = await api.transcribeVoice(
        recording.blob,
        recording.filename,
        surface,
        recording.durationSeconds,
        controller.signal,
      )
      if (!mountedRef.current || controller.signal.aborted) return

      if (result.error || !result.data) {
        const message = result.error || 'Could not transcribe the recording. Try again.'
        const outcome =
          result.errorKind === 'timeout' || /timed out/i.test(message)
            ? 'timeout'
            : result.errorKind === 'server' || /voice service|transcription|provider|configured|enabled/i.test(message)
              ? 'provider_error'
              : 'network_error'
        captureProductEvent('voice_draft_transcribed', {
          surface,
          latency_bucket: latencyBucket(Date.now() - startedAt),
          outcome,
        })
        setError(message)
        setState('error')
        return
      }

      const rawText = result.data.raw_text.trim()
      const suggestedText = result.data.suggested_text.trim() || rawText
      if (!rawText) {
        captureProductEvent('voice_draft_transcribed', {
          surface,
          latency_bucket: latencyBucket(Date.now() - startedAt),
          outcome: 'empty',
        })
        setError('No speech was detected. Try again a little closer to the microphone.')
        setState('error')
        return
      }

      const currentDraft = getDraftRef.current()
      const currentSelection = getSelectionRef.current?.() ?? { start: currentDraft.length, end: currentDraft.length }
      const inserted = insertVoiceDraft(currentDraft, currentSelection, suggestedText)
      const limit = maxDraftLengthRef.current
      if (!voiceDraftWithinLimit(inserted.value, limit)) {
        captureProductEvent('voice_draft_transcribed', {
          surface,
          latency_bucket: latencyBucket(Date.now() - startedAt),
          outcome: 'over_limit',
        })
        const formattedLimit = limit?.toLocaleString() || 'configured'
        setError(`That voice draft would exceed the ${formattedLimit}-character limit. Shorten the current draft or record a shorter addition.`)
        setState('error')
        return
      }

      const nextReview: VoiceDraftReview = {
        rawText,
        suggestedText,
        prefix: inserted.prefix,
        suffix: inserted.suffix,
      }
      onDraftChangeRef.current(inserted.value, inserted.selection)
      setReview(nextReview)
      setState('review')
      const warnings = result.data.warnings || []
      setNotice(
        warnings.includes('cleanup_unavailable')
          ? 'The faithful transcript was used because cleanup was unavailable. Review it before sending.'
          : warnings.length > 0
            ? 'Voice draft added with possible ambiguities. Review technical terms before sending.'
            : 'Voice draft added. Review and edit it before sending.',
      )
      captureProductEvent('voice_draft_transcribed', {
        surface,
        latency_bucket: latencyBucket(Date.now() - startedAt),
        outcome: 'success',
      })
      captureProductEvent('voice_draft_inserted', {
        surface,
        raw_or_cleaned: suggestedText === rawText ? 'raw' : 'cleaned',
      })
      discardSavedRecording()
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) return
      captureProductEvent('voice_draft_transcribed', {
        surface,
        latency_bucket: latencyBucket(Date.now() - startedAt),
        outcome: 'network_error',
      })
      setError((err as Error)?.message || 'Could not transcribe the recording. Your recording is still available to retry.')
      setState('error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [discardSavedRecording, surface])

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return
    const recorder = recorderRef.current
    const stream = streamRef.current
    if (!recorder) {
      releaseRecorderAndStream()
      setState('idle')
      return
    }

    const attempt = attemptRef.current
    clearTimer()
    const elapsedSeconds = Math.min(MAX_VOICE_RECORDING_SECONDS, Math.max(0, (Date.now() - startedAtRef.current) / 1_000))
    setDurationMillis(Math.round(elapsedSeconds * 1_000))
    setState('transcribing')

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const handleStop = () => {
          const resolvedType = mimeTypeRef.current || recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm'
          resolve(new Blob(chunksRef.current, { type: resolvedType }))
        }
        const handleError = () => reject(new Error('The recording could not be finished. Try again.'))

        recorder.onstop = handleStop
        recorder.onerror = handleError
        if (recorder.state === 'inactive') {
          handleStop()
        } else {
          recorder.stop()
        }
      })

      recorderRef.current = null
      streamRef.current = null
      stopMediaStream(stream)
      chunksRef.current = []

      if (!mountedRef.current || attemptRef.current !== attempt) return

      if (blob.size === 0 || elapsedSeconds < 0.4) {
        discardSavedRecording()
        setError('That recording was too short. Click the microphone and speak your draft before stopping.')
        setState('error')
        return
      }
      if (blob.size > MAX_VOICE_RECORDING_BYTES) {
        discardSavedRecording()
        setError('That recording is too large. Record a shorter draft and try again.')
        setState('error')
        return
      }

      const filename = voiceRecordingFilename(blob.type || mimeTypeRef.current)
      const saved: SavedRecording = { blob, filename, durationSeconds: elapsedSeconds }
      recordingRef.current = saved
      setHasRecording(true)
      captureProductEvent('voice_draft_recorded', {
        surface,
        duration_bucket: durationBucket(elapsedSeconds),
      })
      await transcribe(saved)
    } catch (recordingError) {
      releaseRecorderAndStream()
      if (!mountedRef.current || attemptRef.current !== attempt) return
      setError((recordingError as Error).message || 'The recording could not be finished. Try again.')
      setState('error')
    }
  }, [clearTimer, discardSavedRecording, releaseRecorderAndStream, surface, transcribe])

  const stopRef = useRef(stop)
  useEffect(() => { stopRef.current = stop }, [stop])

  const start = useCallback(async () => {
    if (disabled || !supported) return
    if (stateRef.current === 'preparing' || stateRef.current === 'recording' || stateRef.current === 'transcribing') return

    const attempt = ++attemptRef.current
    setState('preparing')
    setReview(null)
    setError(null)
    setNotice(null)
    setDurationMillis(0)
    discardSavedRecording()

    let acquiredStream: MediaStream | null = null
    try {
      const permissionState = await queryMicrophonePermissionState()
      captureProductEvent('voice_draft_started', { surface, permission_state: permissionState })

      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mountedRef.current || attemptRef.current !== attempt) {
        stopMediaStream(acquiredStream)
        return
      }

      const preferredMime = pickSupportedAudioMimeType()
      const recorder = preferredMime
        ? new MediaRecorder(acquiredStream, { mimeType: preferredMime })
        : new MediaRecorder(acquiredStream)

      streamRef.current = acquiredStream
      recorderRef.current = recorder
      chunksRef.current = []
      mimeTypeRef.current = recorder.mimeType || preferredMime || ''

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        if (!mountedRef.current || attemptRef.current !== attempt) return
        releaseRecorderAndStream()
        setError('The microphone stopped unexpectedly. Your typed draft is safe.')
        setState('error')
      }

      startedAtRef.current = Date.now()
      recorder.start(250)
      setState('recording')

      timerRef.current = window.setInterval(() => {
        if (!mountedRef.current || attemptRef.current !== attempt || stateRef.current !== 'recording') return
        const elapsed = Date.now() - startedAtRef.current
        const clamped = Math.min(MAX_VOICE_RECORDING_SECONDS * 1_000, elapsed)
        setDurationMillis(clamped)
        if (elapsed >= MAX_VOICE_RECORDING_SECONDS * 1_000) {
          void stopRef.current()
        }
      }, 200)
    } catch (recordingError) {
      stopMediaStream(acquiredStream)
      if (!mountedRef.current || attemptRef.current !== attempt) return
      releaseRecorderAndStream()

      const err = recordingError as DOMException | Error
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError('Microphone access is off. You can keep typing, or allow microphone access in your browser settings.')
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        setError('No microphone was found on this device. You can keep typing instead.')
      } else {
        setError(err?.message || 'The microphone could not start. Try again.')
      }
      setState('error')
    }
  }, [disabled, discardSavedRecording, releaseRecorderAndStream, supported, surface])

  const cancel = useCallback(() => {
    attemptRef.current += 1
    const discardedStage =
      stateRef.current === 'recording'
        ? 'recording'
        : stateRef.current === 'transcribing'
          ? 'transcribing'
          : stateRef.current === 'review'
            ? 'review'
            : null

    abortRef.current?.abort()
    abortRef.current = null
    releaseRecorderAndStream()
    discardSavedRecording()
    setReview(null)
    setError(null)
    setNotice(null)
    setDurationMillis(0)
    setState('idle')

    if (discardedStage) {
      captureProductEvent('voice_draft_discarded', { surface, stage: discardedStage })
    }
  }, [discardSavedRecording, releaseRecorderAndStream, surface])

  const retry = useCallback(() => {
    if (recordingRef.current) void transcribe(recordingRef.current)
    else void start()
  }, [start, transcribe])

  const recordAgain = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    releaseRecorderAndStream()
    discardSavedRecording()
    setError(null)
    setNotice(null)
    setReview(null)
    setState('idle')
    stateRef.current = 'idle'
    void start()
  }, [discardSavedRecording, releaseRecorderAndStream, start])

  const restore = useCallback(() => {
    if (!review) return
    const restored = restoreRawVoiceDraft(getDraftRef.current(), review)
    if (!restored) {
      setNotice('The text around the voice draft changed, so the original transcript could not be restored automatically. Your edits are preserved.')
      return
    }
    const limit = maxDraftLengthRef.current
    if (limit !== undefined && !voiceDraftWithinLimit(restored.value, limit)) {
      setNotice(`The original transcript would exceed the ${limit.toLocaleString()}-character limit. Your current edits are preserved.`)
      return
    }
    onDraftChangeRef.current(restored.value, restored.selection)
    setNotice('Original transcript restored. Review it before sending.')
    captureProductEvent('voice_draft_restored', { surface })
  }, [review, surface])

  const dismissReview = useCallback(() => {
    setNotice(null)
    setState('idle')
  }, [])

  const markSent = useCallback((sentDraft?: string) => {
    attemptRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    releaseRecorderAndStream()
    if (review) {
      captureProductEvent('voice_draft_sent', {
        surface,
        edit_distance_bucket: voiceEditDistanceBucket(review, sentDraft ?? getDraftRef.current()),
      })
    }
    discardSavedRecording()
    setReview(null)
    setNotice(null)
    setError(null)
    setDurationMillis(0)
    setState('idle')
  }, [discardSavedRecording, releaseRecorderAndStream, review, surface])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      attemptRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      releaseRecorderAndStream()
      recordingRef.current = null
    }
  }, [releaseRecorderAndStream])

  return {
    supported,
    state,
    review,
    error,
    notice,
    durationMillis,
    hasRecording,
    maxDurationSeconds: MAX_VOICE_RECORDING_SECONDS,
    start,
    stop,
    cancel,
    retry,
    recordAgain,
    restore,
    dismissReview,
    markSent,
  }
}
