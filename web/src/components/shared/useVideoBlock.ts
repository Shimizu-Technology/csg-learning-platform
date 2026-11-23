import { videoVersions, rememberedVersion } from '../../lib/videoVersions'
import { getYouTubeId, getVimeoEmbed } from '../../lib/videoUrls'
import Player, { type VimeoUrl } from '@vimeo/player'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { captureProductEvent } from '../../lib/analytics'
import { api } from '../../lib/api'
import { normalizeVideoSegments, playbackStart, type VideoSegment } from '../../lib/videoSegments'
import { observedSectionSeconds, sectionRange, SectionCoverage, SeekSettlement, type PlaybackSample } from '../../lib/sectionWatch'
import { creditedPlaybackSeconds, normalizedProgress } from '../../lib/playbackCredit'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { VideoPlayerHandle, VideoProgressData } from './VideoPlayer'

type SaveNotice = 'retry' | 'waiting' | 'stale'
type SourceReport = {
  signature: string
  coverage: SectionCoverage
  pending: Set<string>
  last?: VideoProgressData
  lastOffered?: string
  notice?: SaveNotice
  rejected?: boolean
  retryAt?: number
}

export function useVideoBlock({ block, cohortId, isStaff, readOnly, analyticsContext, onProgressUpdate, isCompleted, setIsCompleted }: ContentBlockRendererProps & { isCompleted: boolean; setIsCompleted: React.Dispatch<React.SetStateAction<boolean>> }) {
  const versions = useMemo(() => videoVersions(block.metadata), [block.metadata])
  const [selectedVersion, setSelectedVersion] = useState(() => rememberedVersion(block.id, versions))
  const versionId = versions.some((v) => v.id === selectedVersion) ? selectedVersion : versions[0]?.id
  const source = versionId ? block.video_progress_sources?.versions?.[versionId] : block.video_progress_sources?.default
  const scope = `${cohortId ?? ''}:${block.id}`
  const [selection, setSelection] = useState<{ segment: VideoSegment; scope: string; source?: string } | null>(null)
  const activeVideoSegment = selection?.scope === scope && selection.source === source ? selection.segment : null
  const [savedSections, setSavedSections] = useState<{ scope: string; ranges: Record<string, string[]> }>({ scope, ranges: {} })
  const [notices, setNotices] = useState<Record<string, { notice?: SaveNotice; rejected?: boolean }>>({})
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const vimeoPlayerRef = useRef<Player | null>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)
  const s3VideoRef = useRef<VideoPlayerHandle>(null)
  const selectionRef = useRef<typeof selection>(null)
  const linkedSeek = useRef<SeekSettlement | null>(null)
  const linkedPauseAt = useRef<number | null>(null)
  const linkedAnchored = useRef(false)
  const linkedBaselineRef = useRef<{ seconds: number; at: number } | null>(null)
  const linkedTotalRef = useRef(block.progress?.video_total_watched || 0)
  const initialLinkedTotal = useRef(linkedTotalRef.current)
  initialLinkedTotal.current = block.progress?.video_total_watched || 0
  const linkedSaveAtRef = useRef(0)
  const saveQueueRef = useRef(Promise.resolve())
  const videoSegments = useMemo(() => normalizeVideoSegments(block.metadata), [block.metadata])
  const hasCore = !!source && videoSegments.some((segment) => segment.required)
  const assetKey = JSON.stringify([scope, source ?? block.video_url ?? block.s3_video_key])
  const rangeSignature = JSON.stringify(videoSegments.map(sectionRange))
  const reports = useMemo(() => new Map<string, SourceReport>(), [scope])
  // The source and its timestamp list jointly identify observed coverage.
  // Preserve coverage for unchanged timestamps and let the API acknowledge
  // or reject ranges that were pending before an edit.
  const report = useMemo<SourceReport>(() => reports.get(assetKey) ?? {
    signature: rangeSignature,
    pending: new Set<string>(),
    coverage: new SectionCoverage(videoSegments),
  }, [reports, assetKey, rangeSignature, videoSegments])
  useLayoutEffect(() => {
    if (report.signature !== rangeSignature) {
      report.signature = rangeSignature
      report.coverage.updateSegments(videoSegments)
    }
    reports.set(assetKey, report)
  }, [reports, assetKey, rangeSignature, report, videoSegments])
  useLayoutEffect(() => {
    linkedTotalRef.current = initialLinkedTotal.current
    linkedBaselineRef.current = null
    linkedSeek.current = null
    linkedPauseAt.current = null
    linkedAnchored.current = false
  }, [assetKey])
  const completedRanges = source ? [
    ...block.progress?.completed_video_sections?.[source] ?? [],
    ...(savedSections.scope === scope ? savedSections.ranges[source] ?? [] : []),
  ] : []

  const selectVideoVersion = useCallback((id: string) => {
    if (id === versionId) return
    s3VideoRef.current?.prepareSourceChange()
    selectionRef.current = null
    setSelection(null)
    setSelectedVersion(id)
    try { localStorage.setItem(`video-version:${block.id}`, id) } catch { /* optional storage */ }
  }, [block.id, versionId])

  const initialVideoPosition = useMemo(() => {
    const raw = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('t')
    const parsed = raw === null || raw.trim() === '' ? null : Number(raw)
    return playbackStart(videoSegments, block.progress?.video_last_position || 0, parsed)
    // A lesson refresh or a progress save should never seek an open embed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, block.video_url, block.s3_video_key])

  const completedRef = useRef(isCompleted)
  const sources = block.video_progress_sources
  const latestRef = useRef({ scope, assetKey, sources, onProgressUpdate, analyticsContext, canTrack: !isStaff && !readOnly })
  useLayoutEffect(() => {
    latestRef.current = { scope, assetKey, sources, onProgressUpdate, analyticsContext, canTrack: !isStaff && !readOnly }
    completedRef.current = isCompleted
  }, [scope, assetKey, sources, onProgressUpdate, analyticsContext, isStaff, readOnly, isCompleted])

  const recordCompletion = useCallback(() => {
    if (latestRef.current.scope !== scope || completedRef.current) return
    completedRef.current = true
    setIsCompleted(true)
    const { analyticsContext, onProgressUpdate } = latestRef.current
    if (analyticsContext) captureProductEvent('learning_step_completed', {
      module_id: analyticsContext.moduleId, lesson_id: analyticsContext.lessonId,
      content_block_id: block.id, block_type: block.block_type, source: 'video',
    })
    onProgressUpdate?.()
  }, [block.block_type, block.id, scope, setIsCompleted])

  const completeLegacyLinkedVideo = useCallback(async () => {
    if (source || completedRef.current || !latestRef.current.canTrack || latestRef.current.assetKey !== assetKey) return
    const result = await api.updateProgress(block.id, 'completed', cohortId)
    if (!result.error && latestRef.current.assetKey === assetKey) recordCompletion()
  }, [assetKey, block.id, cohortId, recordCompletion, source])

  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeRetryKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    activeRetryKey.current = assetKey
    return () => {
      activeRetryKey.current = null
      clearTimeout(retryTimer.current)
    }
  }, [assetKey])
  const saveBlockProgress = useCallback((data: VideoProgressData, retry = false) => {
    const allowed = () => {
      const latest = latestRef.current
      return latest.canTrack && latest.scope === scope && (source
        ? [latest.sources?.default, ...Object.values(latest.sources?.versions ?? {})].includes(source)
        : latest.assetKey === assetKey)
    }
    if (!allowed() || report.notice === 'stale') return
    const previous = report.last
    report.last = data
    const offered = [...report.pending]
    const offeredKey = JSON.stringify(offered)
    const changedRanges = report.lastOffered !== offeredKey && offered.length > 0
    report.lastOffered = offeredKey
    if (!retry && !changedRanges && previous && previous.last_position_seconds === data.last_position_seconds &&
        previous.total_watched_seconds === data.total_watched_seconds && previous.duration_seconds === data.duration_seconds) return

    const notify = (notice?: SaveNotice) => {
      report.notice = notice
      setNotices((current) => ({ ...current, [assetKey]: { notice, rejected: report.rejected } }))
    }
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (!allowed() || report.notice === 'stale' || (retry && activeRetryKey.current !== assetKey)) return
      const pending = offered.filter((range) => report.pending.has(range))
      const ready = Date.now() >= (report.retryAt ?? 0)
      if (retry && !ready) {
        clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          if (report.last && activeRetryKey.current === assetKey) saveBlockProgress(report.last, true)
        }, Math.max(1, (report.retryAt ?? 0) - Date.now()))
        return
      }
      const res = await api.updateContentBlockVideoProgress(block.id, {
        ...data,
        ...(source ? { video_source: source } : {}),
        ...(ready && pending.length ? { completed_section_ranges: pending } : {}),
      }, cohortId)
      if (!allowed()) return
      const saved = res.data?.video_progress
      if (!saved) {
        notify(res.status === 409 || res.status === 403 || res.status === 404 || res.status === 422 ? 'stale' : 'retry')
        return
      }

      if (source && saved.completed_video_sections) {
        const ranges = saved.completed_video_sections[source] ?? []
        for (const range of ranges) report.pending.delete(range)
        for (const range of saved.section_rejected_ranges ?? []) report.pending.delete(range)
        if (ready) report.retryAt = saved.section_retry_after_seconds ? Date.now() + saved.section_retry_after_seconds * 1000 : undefined
        if (saved.section_rejected_ranges?.length) report.rejected = true
        if (report.pending.size && (!ready || saved.section_retry_after_seconds)) notify('waiting')
        else if (report.pending.size && pending.length) notify('retry')
        else notify()
        setSavedSections((previous) => ({
          scope,
          ranges: { ...(previous.scope === scope ? previous.ranges : {}), [source]: ranges },
        }))
      } else notify()
      if (saved.completed) recordCompletion()
    }).catch(() => { if (allowed()) notify('retry') })
  }, [assetKey, block.id, cohortId, recordCompletion, report, scope, source])

  const onSaveProgress = useCallback((data: VideoProgressData) => saveBlockProgress(data), [saveBlockProgress])
  const retryProgress = useCallback(() => {
    clearTimeout(retryTimer.current)
    if (report.last && activeRetryKey.current === assetKey) saveBlockProgress(report.last, true)
  }, [assetKey, report, saveBlockProgress])

  const onPlaybackSample = useCallback<PlaybackSample>((from, to, watched) => {
    if (!source || latestRef.current.assetKey !== assetKey || !latestRef.current.canTrack) return
    for (const range of report.coverage.observe(from, to, watched)) report.pending.add(range)
  }, [assetKey, report, source])

  const finishActiveVideoSegment = useCallback((progress: VideoProgressData | null) => {
    selectionRef.current = null
    setSelection(null)
    if (progress) saveBlockProgress(progress)
  }, [saveBlockProgress])

  const sampleLinkedVideo = useCallback((seconds: number, duration: number, playing: boolean, rate: number, pause: () => void, ended = false, seeking = false) => {
    if (latestRef.current.assetKey !== assetKey) return
    const at = performance.now()
    const last = linkedBaselineRef.current
    linkedBaselineRef.current = { seconds, at }
    const wait = linkedSeek.current?.sample(seconds, at, seeking)
    if (wait === 'landed' || wait === 'expired') linkedSeek.current = null
    if (wait === 'expired') {
      selectionRef.current = null
      setSelection(null)
    }
    if (!wait && last && !seeking) {
      const elapsed = (at - last.at) / 1000
      const watched = observedSectionSeconds(creditedPlaybackSeconds({
        previousTime: last.seconds, currentTime: seconds, elapsedWallSeconds: elapsed, playbackRate: rate, playing: playing || ended,
      }), elapsed, rate)
      linkedTotalRef.current += watched
      onPlaybackSample(last.seconds, seconds, watched)
    }
    const progress = normalizedProgress(seconds, linkedTotalRef.current, duration, ended)
    if (!progress) return
    const selection = selectionRef.current
    if (ended && selection && seconds < selection.segment.end_seconds) finishActiveVideoSegment(null)
    if (!wait && !seeking && selection?.scope === scope && selection.source === source && seconds >= selection.segment.end_seconds) {
      if (!ended) {
        linkedPauseAt.current = at
        pause()
      }
      finishActiveVideoSegment(source ? progress : null)
      return
    }
    if (playing && !linkedAnchored.current && source) {
      linkedAnchored.current = true
      linkedSaveAtRef.current = at
      saveBlockProgress(progress)
    } else if (ended || (playing && at - linkedSaveAtRef.current >= 10_000)) {
      linkedSaveAtRef.current = at
      if (source) saveBlockProgress(progress)
    }
  }, [assetKey, finishActiveVideoSegment, onPlaybackSample, saveBlockProgress, scope, source])

  useEffect(() => {
    if (block.s3_video_key || !block.video_url || !vimeoContainerRef.current) return
    const vimeo = getVimeoEmbed(block.video_url)
    if (!vimeo) return

    const vimeoUrl = (vimeo.hash ? `https://vimeo.com/${vimeo.id}/${vimeo.hash}` : `https://vimeo.com/${vimeo.id}`) as VimeoUrl
    const player = new Player(vimeoContainerRef.current, { url: vimeoUrl, width: 640, responsive: true })
    vimeoPlayerRef.current = player
    linkedBaselineRef.current = null
    linkedAnchored.current = false
    let rate = 1
    let playing = false
    let seeking = false
    let buffering = false
    const sample = ({ seconds, duration }: { seconds: number; duration: number }, ended = false) => {
      sampleLinkedVideo(seconds, duration, playing && !buffering, rate, () => { void player.pause().catch(() => undefined) }, ended, seeking)
    }
    player.on('play', () => { playing = true; linkedBaselineRef.current = null })
    player.on('pause', (event) => {
      const automatic = linkedPauseAt.current !== null && performance.now() - linkedPauseAt.current < 2000
      if (!automatic) sample(event)
      playing = false
      const progress = normalizedProgress(event.seconds, linkedTotalRef.current, event.duration)
      if (progress && !automatic && source) saveBlockProgress(progress)
      linkedPauseAt.current = null
    })
    player.on('seeking', () => { seeking = true; linkedBaselineRef.current = null })
    player.on('seeked', (event) => {
      seeking = false
      linkedBaselineRef.current = null
      sample(event)
    })
    player.on('bufferstart', () => { buffering = true })
    player.on('bufferend', () => { buffering = false })
    player.on('playbackratechange', ({ playbackRate }) => { rate = playbackRate })
    player.on('timeupdate', sample)
    player.on('ended', (event) => {
      sample(event, true)
      if (!source) void completeLegacyLinkedVideo()
    })
    if (initialVideoPosition > 0) {
      void player.ready().then(() => player.setCurrentTime(initialVideoPosition)).catch(() => undefined)
    }
    return () => {
      vimeoPlayerRef.current = null
      void player.destroy()
    }
  }, [block.s3_video_key, block.video_url, completeLegacyLinkedVideo, initialVideoPosition, sampleLinkedVideo, saveBlockProgress, source])

  useEffect(() => {
    if (block.s3_video_key || !block.video_url || !getYouTubeId(block.video_url)) return
    const iframe = ytIframeRef.current
    linkedBaselineRef.current = null
    linkedAnchored.current = false
    let state = -1
    let rate = 1
    let duration = 0
    let finalized = false
    const pause = () => iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com')
    const stateChanged = (next: number) => {
      const wasPlaying = state === 1
      state = next
      if (next === 0 && (!source || duration > 0) && !finalized) {
        finalized = true
        if (duration > 0) sampleLinkedVideo(duration, duration, false, rate, pause, true)
        if (!source) void completeLegacyLinkedVideo()
      } else if (next === 2 && wasPlaying && linkedBaselineRef.current) {
        const automatic = linkedPauseAt.current !== null && performance.now() - linkedPauseAt.current < 2000
        if (!automatic && source) {
          const progress = normalizedProgress(linkedBaselineRef.current.seconds, linkedTotalRef.current, duration)
          if (progress) saveBlockProgress(progress)
        }
        linkedPauseAt.current = null
      } else if (next === 1) finalized = false
    }
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || event.source !== iframe?.contentWindow) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.event === 'onStateChange' && String(data.id) === String(block.id)) {
          stateChanged(data.info)
        }
        if (!['infoDelivery', 'initialDelivery'].includes(data?.event)) return
        const info = data.info
        if (Number.isFinite(info?.playbackRate)) rate = info.playbackRate
        if (Number.isFinite(info?.duration)) duration = info.duration
        if (Number.isFinite(info?.playerState) || state === 0) stateChanged(info.playerState ?? state)
        if (Number.isFinite(info?.currentTime) && state !== 0) {
          sampleLinkedVideo(info.currentTime, duration, state === 1, rate, pause)
        }
      } catch {
        // Ignore non-JSON messages.
      }
    }
    const listen = () => {
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: block.id }), 'https://www.youtube.com')
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), 'https://www.youtube.com')
    }
    window.addEventListener('message', handleMessage)
    iframe?.addEventListener('load', listen)
    listen()
    return () => {
      window.removeEventListener('message', handleMessage)
      iframe?.removeEventListener('load', listen)
    }
  }, [block.id, block.s3_video_key, block.video_url, completeLegacyLinkedVideo, sampleLinkedVideo, saveBlockProgress, source])

  const fetchBlockStreamUrl = useCallback(async () => {
    const res = await api.getContentBlockVideoStream(block.id, cohortId, versionId)
    if (source && res.data?.video_source && res.data.video_source !== source) return null
    return res.data?.stream_url || null
  }, [block.id, cohortId, source, versionId])

  const handleVideoSegmentSelect = useCallback((segment: VideoSegment) => {
    const seconds = segment.start_seconds
    // An explicit seek supersedes the incoming deep link. Let a reload
    // resume the actual saved playhead instead of either section's start.
    const url = new URL(window.location.href)
    if (url.searchParams.has('t')) {
      url.searchParams.delete('t')
      window.history.replaceState(window.history.state, '', url)
    }
    const attempt = { segment, scope, source }
    selectionRef.current = attempt
    linkedBaselineRef.current = null
    linkedSeek.current = new SeekSettlement(seconds)
    setSelection(attempt)

    if (block.s3_video_key) {
      s3VideoRef.current?.seekTo(seconds, true, segment.end_seconds)
    } else if (ytIframeRef.current) {
      const frame = ytIframeRef.current.contentWindow
      frame?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }), 'https://www.youtube.com')
      frame?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com')
    } else if (vimeoPlayerRef.current) {
      const player = vimeoPlayerRef.current
      void player.getDuration().then(async (duration) => {
        if (selectionRef.current !== attempt) return
        await player.setCurrentTime(Math.min(seconds, duration))
        if (selectionRef.current === attempt) await player.play()
      }).catch(() => undefined)
    }
  }, [block.s3_video_key, scope, source])

  return {
    versions, versionId, source, selectVideoVersion, activeVideoSegment, completedRanges, hasCore,
    saveNotice: notices[assetKey]?.notice, rejectedSection: notices[assetKey]?.rejected,
    retryProgress, vimeoContainerRef, ytIframeRef, s3VideoRef,
    videoSegments, initialVideoPosition, finishActiveVideoSegment, onPlaybackSample, fetchBlockStreamUrl, onSaveProgress, handleVideoSegmentSelect,
  }
}
