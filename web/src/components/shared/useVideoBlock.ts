import { videoVersions, rememberedVersion } from '../../lib/videoVersions'
import { getYouTubeId, getVimeoEmbed } from '../../lib/videoUrls'
import Player, { type VimeoUrl } from '@vimeo/player'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { captureProductEvent } from '../../lib/analytics'
import { api } from '../../lib/api'
import { isVideoSegmentSeekPosition, normalizeVideoSegments, playbackStart, type VideoSegment } from '../../lib/videoSegments'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { VideoPlayerHandle } from './VideoPlayer'

export function useVideoBlock({ block, cohortId, isStaff, readOnly, analyticsContext, onProgressUpdate, isCompleted, setIsCompleted }: ContentBlockRendererProps & { isCompleted: boolean; setIsCompleted: React.Dispatch<React.SetStateAction<boolean>> }) {
  const versions = useMemo(() => videoVersions(block.metadata), [block.metadata])
  const [selectedVersion, setSelectedVersion] = useState(() => rememberedVersion(block.id, versions))
  const versionId = versions.some((v) => v.id === selectedVersion) ? selectedVersion : versions[0]?.id
  const selectVideoVersion = useCallback((id: string) => {
    s3VideoRef.current?.prepareSourceChange()
    setSelectedVersion(id)
    try { localStorage.setItem(`video-version:${block.id}`, id) } catch { /* optional storage */ }
    setActiveVideoSegment(null)
    setCompletedVideoSegment(null)
  }, [block.id])
  const [activeVideoSegment, setActiveVideoSegment] = useState<VideoSegment | null>(null)
  const [completedVideoSegment, setCompletedVideoSegment] = useState<VideoSegment | null>(null)
  const vimeoContainerRef = useRef<HTMLDivElement>(null)
  const vimeoPlayerRef = useRef<Player | null>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)
  const s3VideoRef = useRef<VideoPlayerHandle>(null)
  const activeVideoSegmentRef = useRef<VideoSegment | null>(null)
  const pendingVideoSegmentRef = useRef<VideoSegment | null>(null)
  const isCompletedRef = useRef(isCompleted)
  useEffect(() => { isCompletedRef.current = isCompleted }, [isCompleted])
  useEffect(() => {
    activeVideoSegmentRef.current = null
    pendingVideoSegmentRef.current = null
    setActiveVideoSegment(null)
    setCompletedVideoSegment(null)
  }, [block.id])
  const videoSegments = useMemo(() => normalizeVideoSegments(block.metadata), [block.metadata])
  const deepLinkedPosition = useMemo(() => {
    if (typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get('t')
    if (raw === null || raw.trim() === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }, [block.id])
  const initialVideoPosition = playbackStart(videoSegments, block.progress?.video_last_position || 0, deepLinkedPosition)

  const segmentForPlaybackPosition = useCallback((seconds: number) => {
    const pending = pendingVideoSegmentRef.current
    if (pending) {
      if (!isVideoSegmentSeekPosition(seconds, pending)) return null
      pendingVideoSegmentRef.current = null
      activeVideoSegmentRef.current = pending
      return pending
    }
    return activeVideoSegmentRef.current
  }, [])

  const finishActiveVideoSegment = useCallback(() => {
    const segment = activeVideoSegmentRef.current
    if (!segment) return
    activeVideoSegmentRef.current = null
    pendingVideoSegmentRef.current = null
    setActiveVideoSegment(null)
    setCompletedVideoSegment(segment)
  }, [])

  const markVideoCompleted = useCallback(async () => {
    if (isStaff || readOnly) return
    if (isCompletedRef.current) return
    const res = await api.updateProgress(block.id, 'completed', cohortId)
    if (!res.error) {
      setIsCompleted(true)
      if (analyticsContext) captureProductEvent('learning_step_completed', {
        module_id: analyticsContext.moduleId,
        lesson_id: analyticsContext.lessonId,
        content_block_id: block.id,
        block_type: block.block_type,
        source: 'video',
      })
      onProgressUpdate?.()
    }
  }, [analyticsContext, block.block_type, block.id, cohortId, isStaff, readOnly, onProgressUpdate])

  // Vimeo completion tracking
  useEffect(() => {
    const isVideoBlock = block.block_type === 'video' || block.block_type === 'recording'
    if (!isVideoBlock || !block.video_url) return

    const vimeo = getVimeoEmbed(block.video_url)
    if (!vimeo || !vimeoContainerRef.current) return

    const vimeoUrl = (
      vimeo.hash
        ? `https://vimeo.com/${vimeo.id}/${vimeo.hash}`
        : `https://vimeo.com/${vimeo.id}`
    ) as VimeoUrl

    const player = new Player(vimeoContainerRef.current, {
      url: vimeoUrl as `https://vimeo.com/${string}`,
      width: 640,
      responsive: true,
    })
    vimeoPlayerRef.current = player

    player.on('ended', markVideoCompleted)
    player.on('timeupdate', ({ seconds }) => {
      const segment = segmentForPlaybackPosition(seconds)
      if (!segment || seconds < segment.end_seconds) return
      void player.pause().catch(() => undefined)
      finishActiveVideoSegment()
    })
    if (initialVideoPosition > 0) {
      void player.ready().then(() => player.setCurrentTime(initialVideoPosition)).catch(() => undefined)
    }

    return () => {
      vimeoPlayerRef.current = null
      player.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url, finishActiveVideoSegment, initialVideoPosition, markVideoCompleted, segmentForPlaybackPosition])

  // YouTube completion tracking via iframe API postMessage
  useEffect(() => {
    const isVideoBlock = block.block_type === 'video' || block.block_type === 'recording'
    if (!isVideoBlock || !block.video_url) return

    const ytId = getYouTubeId(block.video_url)
    if (!ytId) return

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com') return
      if (event.source !== ytIframeRef.current?.contentWindow) return
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        if (data?.event === 'onStateChange' && data?.info === 0 && String(data?.id) === String(block.id)) {
          markVideoCompleted()
        }
        const currentTime = Number(data?.info?.currentTime)
        const segment = data?.event === 'infoDelivery' && Number.isFinite(currentTime) ? segmentForPlaybackPosition(currentTime) : null
        if (segment && currentTime >= segment.end_seconds) {
          ytIframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
            'https://www.youtube.com'
          )
          finishActiveVideoSegment()
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    window.addEventListener('message', handleMessage)

    const iframe = ytIframeRef.current
    const sendListenCommand = () => {
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: block.id }),
        'https://www.youtube.com'
      )
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }),
        'https://www.youtube.com'
      )
    }

    if (iframe) {
      iframe.addEventListener('load', sendListenCommand)
      if (iframe.contentWindow) sendListenCommand()
    }

    return () => {
      window.removeEventListener('message', handleMessage)
      if (iframe) {
        iframe.removeEventListener('load', sendListenCommand)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.block_type, block.video_url, finishActiveVideoSegment, markVideoCompleted, segmentForPlaybackPosition])

  const fetchBlockStreamUrl = useCallback(async () => {
    const res = await api.getContentBlockVideoStream(block.id, cohortId, versionId)
    return res.data?.stream_url || null
  }, [block.id, cohortId, versionId])

  const saveBlockProgress = useCallback((data: import('./VideoPlayer').VideoProgressData) => {
    if (isStaff || readOnly) return
    api.updateContentBlockVideoProgress(block.id, data, cohortId).then(res => {
      if (res.data?.video_progress?.completed) {
        setIsCompleted(true)
        onProgressUpdate?.()
      }
    })
  }, [block.id, cohortId, isStaff, readOnly, onProgressUpdate])

  const handleVideoSegmentSelect = useCallback((segment: VideoSegment) => {
    const seconds = segment.start_seconds
    setActiveVideoSegment(segment)
    setCompletedVideoSegment(null)
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('t', String(seconds))
      window.history.replaceState(window.history.state, '', nextUrl)
    }

    if (block.s3_video_key) {
      pendingVideoSegmentRef.current = null
      activeVideoSegmentRef.current = segment
      s3VideoRef.current?.seekTo(seconds, true)
      return
    }
    if (block.video_url && getYouTubeId(block.video_url)) {
      activeVideoSegmentRef.current = null
      pendingVideoSegmentRef.current = segment
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
        'https://www.youtube.com'
      )
      ytIframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
        'https://www.youtube.com'
      )
      return
    }
    if (vimeoPlayerRef.current) {
      activeVideoSegmentRef.current = null
      pendingVideoSegmentRef.current = segment
      void vimeoPlayerRef.current.setCurrentTime(seconds).then(() => vimeoPlayerRef.current?.play()).catch(() => undefined)
    }
  }, [block.s3_video_key, block.video_url])
 return { versions, versionId, selectVideoVersion, activeVideoSegment, completedVideoSegment, vimeoContainerRef, ytIframeRef, s3VideoRef, videoSegments, initialVideoPosition, finishActiveVideoSegment, fetchBlockStreamUrl, saveBlockProgress, handleVideoSegmentSelect }
}
