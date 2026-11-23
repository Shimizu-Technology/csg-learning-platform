import { videoVersions, rememberedVersion } from '../../lib/videoVersions'
import { getYouTubeId, getVimeoEmbed } from '../../lib/videoUrls'
import Player, { type VimeoUrl } from '@vimeo/player'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { captureProductEvent } from '../../lib/analytics'
import { api } from '../../lib/api'
import { normalizeVideoSegments, playbackStart, type VideoSegment } from '../../lib/videoSegments'
import { observedSectionSeconds, sectionRange, SectionWatch, type PlaybackSample } from '../../lib/sectionWatch'
import { creditedPlaybackSeconds, normalizedProgress } from '../../lib/playbackCredit'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { VideoPlayerHandle, VideoProgressData } from './VideoPlayer'

export function useVideoBlock({ block, cohortId, isStaff, readOnly, analyticsContext, onProgressUpdate, isCompleted, setIsCompleted }: ContentBlockRendererProps & { isCompleted: boolean; setIsCompleted: React.Dispatch<React.SetStateAction<boolean>> }) {
  const versions = useMemo(() => videoVersions(block.metadata), [block.metadata])
  const [selectedVersion, setSelectedVersion] = useState(() => rememberedVersion(block.id, versions))
  const versionId = versions.some((v) => v.id === selectedVersion) ? selectedVersion : versions[0]?.id
  const source = versionId ? block.video_progress_sources?.versions?.[versionId] : block.video_progress_sources?.default
  const scope = `${cohortId ?? ''}:${block.id}`
  const [selection, setSelection] = useState<{ segment: VideoSegment; scope: string; source?: string } | null>(null)
  const activeVideoSegment = selection?.scope === scope && selection.source === source ? selection.segment : null
  const [savedSections, setSavedSections] = useState<{ scope: string; ranges: Record<string, string[]> }>({ scope, ranges: {} })
  const [saveFailed, setSaveFailed] = useState(false)
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const vimeoPlayerRef = useRef<Player | null>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)
  const s3VideoRef = useRef<VideoPlayerHandle>(null)
  const sectionWatchRef = useRef<{ watch: SectionWatch; scope: string; source?: string } | null>(null)
  const linkedBaselineRef = useRef<{ seconds: number; at: number } | null>(null)
  const linkedTotalRef = useRef(block.progress?.video_total_watched || 0)
  const linkedSaveAtRef = useRef(0)
  const linkedArmedRef = useRef(false)
  const pendingRangesRef = useRef(new Map<string, Set<string>>())
  const saveQueueRef = useRef(Promise.resolve())
  const videoSegments = useMemo(() => normalizeVideoSegments(block.metadata), [block.metadata])
  const hasCore = videoSegments.some((segment) => segment.required)
  const completedRanges = source ? [
    ...block.progress?.completed_video_sections?.[source] ?? [],
    ...(savedSections.scope === scope ? savedSections.ranges[source] ?? [] : []),
  ] : []

  const selectVideoVersion = useCallback((id: string) => {
    if (id === versionId) return
    s3VideoRef.current?.prepareSourceChange()
    sectionWatchRef.current = null
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
  const latestRef = useRef({ scope, onProgressUpdate, analyticsContext, canTrack: !isStaff && !readOnly })
  useEffect(() => {
    latestRef.current = { scope, onProgressUpdate, analyticsContext, canTrack: !isStaff && !readOnly }
    completedRef.current = isCompleted
  }, [scope, onProgressUpdate, analyticsContext, isStaff, readOnly, isCompleted])

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

  const saveBlockProgress = useCallback((data: VideoProgressData, finishedRange?: string) => {
    if (!latestRef.current.canTrack) return
    const key = `${scope}:${source ?? ''}`
    if (finishedRange && source) {
      const pending = pendingRangesRef.current.get(key) ?? new Set<string>()
      pending.add(finishedRange)
      pendingRangesRef.current.set(key, pending)
    }

    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (latestRef.current.scope !== scope || !latestRef.current.canTrack) return
      const pending = pendingRangesRef.current.get(key)
      const res = await api.updateContentBlockVideoProgress(block.id, {
        ...data,
        ...(source ? { video_source: source } : {}),
        ...(pending?.size ? { completed_section_ranges: [...pending] } : {}),
      }, cohortId)
      const saved = res.data?.video_progress
      if (latestRef.current.scope !== scope) return
      if (finishedRange || pending?.size) setSaveFailed(!saved)
      if (!saved) return
      if (source && saved.completed_video_sections) {
        const ranges = saved.completed_video_sections[source] ?? []
        for (const range of ranges) pending?.delete(range)
        if (pending?.size) setSaveFailed(true)
        else pendingRangesRef.current.delete(key)
        setSavedSections((previous) => ({
          scope,
          ranges: { ...(previous.scope === scope ? previous.ranges : {}), [source]: ranges },
        }))
      }
      if (saved.completed) recordCompletion()
    }).catch(() => {
      if (pendingRangesRef.current.get(key)?.size && latestRef.current.scope === scope) setSaveFailed(true)
    })
  }, [block.id, cohortId, recordCompletion, scope, source])

  const onSaveProgress = useCallback((data: VideoProgressData) => saveBlockProgress(data), [saveBlockProgress])

  const onPlaybackSample = useCallback<PlaybackSample>((from, to, watched) => {
    const attempt = sectionWatchRef.current
    if (attempt?.scope === scope && attempt.source === source) attempt.watch.observe(from, to, watched)
  }, [scope, source])

  const finishActiveVideoSegment = useCallback((progress: VideoProgressData | null) => {
    const attempt = sectionWatchRef.current
    if (attempt?.scope !== scope || attempt.source !== source) return
    sectionWatchRef.current = null
    setSelection(null)
    if (attempt.watch.finished && progress && source) saveBlockProgress(progress, sectionRange(attempt.watch.segment))
  }, [saveBlockProgress, scope, source])

  const sampleLinkedVideo = useCallback((seconds: number, duration: number, playing: boolean, rate: number, pause: () => void) => {
    const attempt = sectionWatchRef.current
    if (attempt?.scope !== scope || attempt.source !== source) return
    const { watch } = attempt
    const at = performance.now()
    const last = linkedBaselineRef.current
    linkedBaselineRef.current = { seconds, at }
    // Providers may report the old playhead until their asynchronous seek is
    // applied. Arm the timer near the selected start before allowing auto-stop.
    if (!linkedArmedRef.current) {
      if (Math.abs(seconds - watch.segment.start_seconds) > 0.6) return
      linkedArmedRef.current = true
      if (playing) watch.observe(watch.segment.start_seconds, seconds, Math.max(0, seconds - watch.segment.start_seconds))
      return
    }
    if (!last) return
    const elapsed = (at - last.at) / 1000
    const watched = elapsed <= 2.5 ? creditedPlaybackSeconds({
      previousTime: last.seconds, currentTime: seconds, elapsedWallSeconds: elapsed, playbackRate: rate, playing,
    }) : 0
    watch.observe(last.seconds, seconds, observedSectionSeconds(watched, elapsed, rate))
    linkedTotalRef.current += watched
    const progress = normalizedProgress(seconds, linkedTotalRef.current, duration)
    if (seconds >= watch.segment.end_seconds) {
      pause()
      finishActiveVideoSegment(progress)
    } else if (source && progress && at - linkedSaveAtRef.current >= 10_000) {
      linkedSaveAtRef.current = at
      saveBlockProgress(progress)
    }
  }, [finishActiveVideoSegment, saveBlockProgress, scope, source])

  const markLinkedVideoCompleted = useCallback(async () => {
    if (hasCore || !latestRef.current.canTrack || completedRef.current) return
    const res = await api.updateProgress(block.id, 'completed', cohortId)
    if (!res.error) recordCompletion()
  }, [block.id, cohortId, hasCore, recordCompletion])

  useEffect(() => {
    if (block.s3_video_key || !block.video_url || !vimeoContainerRef.current) return
    const vimeo = getVimeoEmbed(block.video_url)
    if (!vimeo) return

    const vimeoUrl = (vimeo.hash ? `https://vimeo.com/${vimeo.id}/${vimeo.hash}` : `https://vimeo.com/${vimeo.id}`) as VimeoUrl
    const player = new Player(vimeoContainerRef.current, { url: vimeoUrl, width: 640, responsive: true })
    vimeoPlayerRef.current = player
    let rate = 1
    let playing = false
    const sample = ({ seconds, duration }: { seconds: number; duration: number }, ended = false) => {
      sampleLinkedVideo(seconds, duration, playing || ended, rate, () => { void player.pause().catch(() => undefined) })
    }
    player.on('play', () => { playing = true })
    player.on('pause', () => { playing = false })
    player.on('seeking', () => { linkedBaselineRef.current = null })
    player.on('seeked', sample)
    player.on('playbackratechange', ({ playbackRate }) => { rate = playbackRate })
    player.on('timeupdate', sample)
    player.on('ended', (event) => {
      sample(event, true)
      void markLinkedVideoCompleted()
    })
    if (initialVideoPosition > 0) {
      void player.ready().then(() => player.setCurrentTime(initialVideoPosition)).catch(() => undefined)
    }
    return () => {
      vimeoPlayerRef.current = null
      void player.destroy()
    }
  }, [block.s3_video_key, block.video_url, initialVideoPosition, markLinkedVideoCompleted, sampleLinkedVideo])

  useEffect(() => {
    if (block.s3_video_key || !block.video_url || !getYouTubeId(block.video_url)) return
    const iframe = ytIframeRef.current
    let state = -1
    let rate = 1
    let duration = 0
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || event.source !== iframe?.contentWindow) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.event === 'onStateChange' && String(data.id) === String(block.id)) {
          state = data.info
          if (state === 0) void markLinkedVideoCompleted()
        }
        if (!['infoDelivery', 'initialDelivery'].includes(data?.event)) return
        const info = data.info
        if (Number.isFinite(info?.playerState)) state = info.playerState
        if (Number.isFinite(info?.playbackRate)) rate = info.playbackRate
        if (Number.isFinite(info?.duration)) duration = info.duration
        if (Number.isFinite(info?.currentTime)) {
          sampleLinkedVideo(info.currentTime, duration, state === 1 || state === 0, rate, () => {
            iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com')
          })
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
  }, [block.id, block.s3_video_key, block.video_url, markLinkedVideoCompleted, sampleLinkedVideo])

  const fetchBlockStreamUrl = useCallback(async () => {
    const res = await api.getContentBlockVideoStream(block.id, cohortId, versionId)
    if (source && res.data?.video_source && res.data.video_source !== source) return null
    return res.data?.stream_url || null
  }, [block.id, cohortId, source, versionId])

  const handleVideoSegmentSelect = useCallback((segment: VideoSegment) => {
    const seconds = segment.start_seconds
    const attempt = { watch: new SectionWatch(segment), scope, source }
    sectionWatchRef.current = attempt
    linkedBaselineRef.current = null
    linkedArmedRef.current = false
    setSelection({ segment, scope, source })

    if (block.s3_video_key) {
      s3VideoRef.current?.seekTo(seconds, true, segment.end_seconds)
    } else if (ytIframeRef.current) {
      const frame = ytIframeRef.current.contentWindow
      frame?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }), 'https://www.youtube.com')
      frame?.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), 'https://www.youtube.com')
    } else if (vimeoPlayerRef.current) {
      const player = vimeoPlayerRef.current
      void player.setCurrentTime(seconds).then((position) => {
        if (sectionWatchRef.current !== attempt) return
        linkedBaselineRef.current = { seconds: position, at: performance.now() }
        linkedArmedRef.current = true
        return player.play()
      }).catch(() => undefined)
    }
  }, [block.s3_video_key, scope, source])

  return {
    versions, versionId, selectVideoVersion, activeVideoSegment, completedRanges, saveFailed, vimeoContainerRef, ytIframeRef, s3VideoRef,
    videoSegments, initialVideoPosition, finishActiveVideoSegment, onPlaybackSample, fetchBlockStreamUrl, onSaveProgress, handleVideoSegmentSelect,
  }
}
