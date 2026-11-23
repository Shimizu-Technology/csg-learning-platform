import type { PlaybackSample } from '../../lib/sectionWatch'
import { creditedPlaybackSeconds, normalizedProgress } from '../../lib/playbackCredit'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import { Play, Pause, Maximize, Volume2, VolumeX, RotateCcw, Loader2, Undo2, Redo2 } from 'lucide-react'

export interface VideoProgressData {
  last_position_seconds: number
  total_watched_seconds: number
  duration_seconds: number
}

interface VideoPlayerProps {
  title: string
  initialPosition?: number
  initialTotalWatched?: number
  fetchStreamUrl: () => Promise<string | null>
  onSaveProgress: (data: VideoProgressData, ended: boolean) => void
  stopAtSeconds?: number | null
  onStopAtReached?: (progress: VideoProgressData | null) => void
  onPlaybackSample?: PlaybackSample
  trackProgress?: boolean
  anchorProgress?: boolean
}

export interface VideoPlayerHandle {
  prepareSourceChange: () => void
  seekTo: (seconds: number, play?: boolean, stopAt?: number) => void
}

const controlClass = 'inline-flex size-11 items-center justify-center rounded-xl text-on-media hover:bg-on-media/10 active:bg-on-media/20 focus-visible:outline-2 focus-visible:outline-on-media disabled:opacity-50'

const URL_REFRESH_MS = 90 * 60 * 1000

// WebKit-prefixed fullscreen APIs (older desktop Safari, and iPhone Safari's video-only fullscreen).
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }
type FullscreenContainer = HTMLDivElement & { webkitRequestFullscreen?: () => void }
type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({ title, initialPosition = 0, initialTotalWatched = 0, fetchStreamUrl, onSaveProgress, stopAtSeconds = null, onStopAtReached, onPlaybackSample, trackProgress = true, anchorProgress = false }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const totalWatchedRef = useRef(initialTotalWatched)
  // Track the last observed currentTime so we can attribute watched time from
  // playback-clock deltas instead of wall-clock seconds. The previous wall-clock
  // approach undercounted at >1x playback (a 60s video watched at 1.5x credited
  // ~40s of "watched" time) so the 90% completion check could never fire.
  const lastTimeRef = useRef(0)
  const lastTickAtRef = useRef<number | null>(null)
  const hasRestoredInitialPosition = useRef(false)
  const pendingSeekRef = useRef<{ seconds: number; play: boolean } | null>(null)
  const stopAtSecondsRef = useRef(stopAtSeconds)
  const onStopAtReachedRef = useRef(onStopAtReached)
  const onPlaybackSampleRef = useRef(onPlaybackSample)
  const playbackRateRef = useRef(1)
  const anchoredRef = useRef(false)
  const skipPauseSaveRef = useRef(false)

  useEffect(() => {
    stopAtSecondsRef.current = stopAtSeconds
    onStopAtReachedRef.current = onStopAtReached
    onPlaybackSampleRef.current = onPlaybackSample
  }, [onPlaybackSample, onStopAtReached, stopAtSeconds])

  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bufferingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce the buffering indicator so already-buffered seeks don't flash a spinner.
  const showBufferingSoon = useCallback(() => {
    if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
    bufferingTimerRef.current = setTimeout(() => setBuffering(true), 180)
  }, [])
  const hideBuffering = useCallback(() => {
    if (bufferingTimerRef.current) {
      clearTimeout(bufferingTimerRef.current)
      bufferingTimerRef.current = null
    }
    setBuffering(false)
  }, [])

  const requestGeneration = useRef(0)
  const sourceChangePendingRef = useRef(false)
  const refreshCleanupRef = useRef<(() => void) | null>(null)
  const loadUrl = useCallback(() => {
    const generation = ++requestGeneration.current
    return fetchStreamUrl().then((url) => {
      if (generation !== requestGeneration.current) return null
      if (url) {
        setStreamUrl(url)
        setError(null)
      } else {
        sourceChangePendingRef.current = false
        pendingSeekRef.current = null
        setError('Failed to load video')
      }
      return url ? generation : null
    }).catch(() => {
      if (generation !== requestGeneration.current) return null
      sourceChangePendingRef.current = false
      pendingSeekRef.current = null
      setError('Failed to load video')
      return null
    })
  }, [fetchStreamUrl])

  useEffect(() => {
    loadUrl().then((generation) => {
      if (generation !== null || !sourceChangePendingRef.current) setLoading(false)
    })

    const refreshTimer = setInterval(() => {
      const video = videoRef.current
      const savedTime = video?.currentTime ?? 0
      const wasPaused = video?.paused ?? true

      loadUrl().then((generation) => {
        if (generation === null || generation !== requestGeneration.current) return
        const v = videoRef.current
        if (!v || savedTime <= 0) return
        const onLoaded = () => {
          v.removeEventListener('loadedmetadata', onLoaded)
          if (generation !== requestGeneration.current) return
          v.currentTime = savedTime
          if (!wasPaused) v.play()
        }
        refreshCleanupRef.current?.()
        refreshCleanupRef.current = () => v.removeEventListener('loadedmetadata', onLoaded)
        v.addEventListener('loadedmetadata', onLoaded)
      })
    }, URL_REFRESH_MS)

    return () => { clearInterval(refreshTimer); refreshCleanupRef.current?.() }
  }, [loadUrl])

  const sendProgress = useCallback((ended: boolean) => {
    if (!trackProgress) return
    const video = videoRef.current
    if (!video || !video.duration) return

    const progress = normalizedProgress(video.currentTime, totalWatchedRef.current, video.duration, ended)
    if (progress) onSaveProgress(progress, ended)
  }, [onSaveProgress, trackProgress])

  // Parents pass a new save callback on most renders. The autosave and the
  // unmount save read the latest one through this ref, so a new callback
  // never sends a save by itself: a save that completes the block reloads the
  // lesson, and saving on that re-render looped many times a second.
  const sendProgressRef = useRef(sendProgress)
  useEffect(() => {
    sendProgressRef.current = sendProgress
  }, [sendProgress])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return

    const handleLoaded = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      video.playbackRate = playbackRateRef.current
      sourceChangePendingRef.current = false
      const pendingSeek = pendingSeekRef.current
      if (pendingSeek) {
        const maximum = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : pendingSeek.seconds
        video.currentTime = Math.max(0, Math.min(maximum, pendingSeek.seconds))
        pendingSeekRef.current = null
        hasRestoredInitialPosition.current = true
      } else if (!hasRestoredInitialPosition.current) {
        const maximum = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : initialPosition
        video.currentTime = Math.max(0, Math.min(maximum, initialPosition))
        hasRestoredInitialPosition.current = true
      }
      // Initialize the delta tracker to wherever we landed (resumed position
      // or 0) so the first timeupdate doesn't book a giant fake forward jump.
      lastTimeRef.current = video.currentTime
      lastTickAtRef.current = performance.now()
      setCurrentTime(video.currentTime)
      if (pendingSeek?.play) void video.play()
    }
    const sample = (playing: boolean) => {
      const now = video.currentTime
      const tickNow = performance.now()
      const elapsedSinceLastTick = lastTickAtRef.current ? (tickNow - lastTickAtRef.current) / 1000 : 0
      const watched = creditedPlaybackSeconds({
        previousTime: lastTimeRef.current, currentTime: now,
        elapsedWallSeconds: elapsedSinceLastTick, playbackRate: video.playbackRate,
        playing: playing && !video.seeking,
      })
      totalWatchedRef.current += watched
      onPlaybackSampleRef.current?.(lastTimeRef.current, now, watched)
      lastTimeRef.current = now
      lastTickAtRef.current = tickNow
      setCurrentTime(now)
      const stopAt = stopAtSecondsRef.current
      if (stopAt !== null && !video.seeking && now >= stopAt) {
        stopAtSecondsRef.current = null
        if (!video.paused) {
          skipPauseSaveRef.current = true
          video.pause()
        }
        onStopAtReachedRef.current?.(normalizedProgress(now, totalWatchedRef.current, video.duration))
        return true
      }
    }
    const handleTimeUpdate = () => sample(!video.paused || video.ended)
    const handlePlay = () => {
      skipPauseSaveRef.current = false
      lastTimeRef.current = video.currentTime
      if (anchorProgress && !anchoredRef.current && video.duration) {
        anchoredRef.current = true
        sendProgress(false)
      }
      lastTickAtRef.current = performance.now()
      setPlaying(true)
    }
    const handlePause = () => {
      setPlaying(false)
      // Persist immediately on pause so closing the tab or navigating away
      // right after stopping doesn't lose up to one full 10s autosave window.
      if (skipPauseSaveRef.current || video.ended || sourceChangePendingRef.current) {
        skipPauseSaveRef.current = false
        return
      }
      if (!sample(true)) sendProgress(false)
    }
    const handleError = () => {
      // Expired presigned URLs, missing objects, and mid-stream S3 failures all
      // surface through the media element's `error` event. Without handling it,
      // the player can sit forever on a black box or spinner with no user
      // feedback. Collapse buffering, stop the playing state, and render the
      // existing error fallback instead.
      sourceChangePendingRef.current = false
      pendingSeekRef.current = null
      hideBuffering()
      setLoading(false)
      setPlaying(false)
      setError('Video failed to load. Please refresh and try again.')
    }
    const handleSeeked = () => {
      // After a seek, reset the baseline so we don't immediately credit the
      // gap between old and new positions.
      lastTimeRef.current = video.currentTime
      lastTickAtRef.current = performance.now()
      hideBuffering()
      sample(false)
    }
    const handleEnded = () => {
      setPlaying(false)
      if (!sample(true)) {
        if (stopAtSecondsRef.current !== null) {
          stopAtSecondsRef.current = null
          onStopAtReachedRef.current?.(null)
        }
        sendProgress(true)
      }
    }
    const handleProgress = () => {
      try {
        const ranges = video.buffered
        if (!ranges.length) return
        // Show the buffered range that contains the current playhead, or the last range otherwise.
        const t = video.currentTime
        let end = ranges.end(ranges.length - 1)
        for (let i = 0; i < ranges.length; i++) {
          if (ranges.start(i) <= t && ranges.end(i) >= t) {
            end = ranges.end(i)
            break
          }
        }
        setBufferedEnd(end)
      } catch { /* ignore */ }
    }
    const handleWaiting = () => showBufferingSoon()
    const handlePlaying = () => hideBuffering()
    const handleSeeking = () => {
      lastTickAtRef.current = null
      showBufferingSoon()
    }
    const handleCanPlay = () => hideBuffering()
    // The native fullscreen player has its own mute control; keep ours in step.
    const handleVolumeChange = () => setMuted(video.muted)
    const handleRateChange = () => {
      playbackRateRef.current = video.playbackRate
      setPlaybackRate(video.playbackRate)
    }

    video.addEventListener('loadedmetadata', handleLoaded)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleError)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('progress', handleProgress)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('seeking', handleSeeking)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('volumechange', handleVolumeChange)
    video.addEventListener('ratechange', handleRateChange)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoaded)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleError)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('progress', handleProgress)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('seeking', handleSeeking)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('volumechange', handleVolumeChange)
      video.removeEventListener('ratechange', handleRateChange)
    }
  }, [streamUrl, error, loading, initialPosition, sendProgress, showBufferingSoon, hideBuffering, trackProgress, anchorProgress])

  useEffect(() => {
    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      // Same lifecycle for the auto-hide-controls timer — without this, a
      // pending setTimeout from a quick mouse move right before unmount can
      // fire after the component is gone and call setShowControls on a stale
      // setter (React 18 warns; future strict-mode tightening could throw).
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    }
  }, [])

  // Watched-time accumulation now lives in handleTimeUpdate (playback-clock
  // deltas), so we only need the periodic ping here. 10s cadence so a tab
  // close mid-watch loses at most ~10s of unsaved progress.
  useEffect(() => {
    if (!playing) return
    const interval = setInterval(() => sendProgressRef.current(false), 10000)
    return () => clearInterval(interval)
  }, [playing])

  useEffect(() => {
    return () => { sendProgressRef.current(false) }
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play()
    else video.pause()
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }

  const toggleFullscreen = () => {
    const container = containerRef.current as FullscreenContainer | null
    const video = videoRef.current as FullscreenVideo | null
    if (!container || !video) return
    const doc = document as FullscreenDocument
    if (doc.fullscreenElement) { doc.exitFullscreen().catch(() => undefined); return }
    if (doc.webkitFullscreenElement) { doc.webkitExitFullscreen?.(); return }
    // iPhone Safari has no element fullscreen API: only the <video> itself can
    // go full screen, in the native player. It's the same element, so the
    // position and selected version are still there on exit.
    const enterNativeFullscreen = () => {
      try { video.webkitEnterFullscreen?.() } catch { /* metadata not loaded yet */ }
    }
    if (typeof container.requestFullscreen === 'function') container.requestFullscreen().catch(enterNativeFullscreen)
    else if (typeof container.webkitRequestFullscreen === 'function') container.webkitRequestFullscreen()
    else enterNativeFullscreen()
  }

  useImperativeHandle(ref, () => ({
    prepareSourceChange() {
      ++requestGeneration.current
      refreshCleanupRef.current?.()
      if (sourceChangePendingRef.current) return
      const video = videoRef.current
      sourceChangePendingRef.current = true
      anchoredRef.current = false
      stopAtSecondsRef.current = null
      pendingSeekRef.current = { seconds: video?.currentTime ?? lastTimeRef.current, play: video ? !video.paused : false }
      lastTimeRef.current = pendingSeekRef.current.seconds
      video?.pause()
      sendProgress(false)
      lastTickAtRef.current = null
      setError(null)
      setLoading(true)
      setStreamUrl(null)
    },
    seekTo(seconds: number, play = true, stopAt?: number) {
      if (stopAt !== undefined) stopAtSecondsRef.current = stopAt
      const video = videoRef.current
      const requested = Math.max(0, Math.floor(seconds))
      if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeekRef.current = { seconds: requested, play }
        setCurrentTime(requested)
        return
      }
      const maximum = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : seconds
      const target = Math.max(0, Math.min(maximum, requested))
      video.currentTime = target
      setCurrentTime(target)
      lastTimeRef.current = target
      lastTickAtRef.current = performance.now()
      showBufferingSoon()
      if (play) void video.play()
    },
  }), [showBufferingSoon, sendProgress])

  const seek = (seconds: number) => {
    const video = videoRef.current
    if (!video || !duration) return
    const target = Math.min(duration, Math.max(0, seconds))
    lastTimeRef.current = target
    lastTickAtRef.current = performance.now()
    video.currentTime = target
    setCurrentTime(target)
  }

  const skip = (seconds: number) => {
    const video = videoRef.current
    if (video) seek(video.currentTime + seconds)
  }

  const changeRate = (rate: number) => {
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }

  const handleMouseMove = () => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }

  const restart = () => {
    const video = videoRef.current
    if (!video) return
    seek(0)
    void video.play()
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl bg-media" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 flex items-center justify-center" role="status">
          <span className="sr-only">Loading video</span>
          <div aria-hidden="true" className="animate-spin h-8 w-8 border-4 border-on-media/30 border-t-on-media rounded-full" />
        </div>
      </div>
    )
  }

  if (error || !streamUrl) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl bg-media" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-on-media/80">
          {error || 'Video unavailable'}
        </div>
      </div>
    )
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0

  return (
    <div
      ref={containerRef}
      className="@container group relative w-full overflow-hidden rounded-2xl bg-media [&:fullscreen]:grid [&:fullscreen]:h-dvh [&:fullscreen]:w-dvw [&:fullscreen]:grid-rows-[minmax(0,1fr)_auto]"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (playing) setShowControls(false) }}
    >
      <div className="relative aspect-video w-full group-[:fullscreen]:aspect-auto group-[:fullscreen]:min-h-0">
        <video
          ref={videoRef}
          src={streamUrl}
          muted={muted}
          className="absolute inset-0 w-full h-full object-contain"
          onClick={togglePlay}
          playsInline
          preload="metadata"
          title={title}
        />

        {!playing && !buffering && (
          <button
            type="button"
            aria-label={`Play ${title}`}
            onClick={togglePlay}
            className="group/play absolute inset-0 flex items-center justify-center bg-media/30 transition-colors duration-150 hover:bg-media/40"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-on-media/90 shadow-overlay transition-transform duration-150 ease-out group-active/play:scale-95 sm:h-20 sm:w-20">
              <Play className="ml-1 h-8 w-8 text-media sm:h-10 sm:w-10" fill="currentColor" aria-hidden="true" />
            </div>
          </button>
        )}

        {buffering && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-media/20">
            <Loader2 className="h-10 w-10 text-on-media/90 animate-spin" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className={`relative px-2 pb-1 pointer-fine:@min-[24rem]:group-not-[:fullscreen]:pointer-events-none pointer-fine:@min-[24rem]:group-not-[:fullscreen]:absolute pointer-fine:@min-[24rem]:group-not-[:fullscreen]:inset-x-0 pointer-fine:@min-[24rem]:group-not-[:fullscreen]:bottom-0 pointer-fine:@min-[24rem]:group-not-[:fullscreen]:bg-linear-to-t pointer-fine:@min-[24rem]:group-not-[:fullscreen]:from-media/95 pointer-fine:@min-[24rem]:group-not-[:fullscreen]:to-transparent pointer-fine:@min-[24rem]:group-not-[:fullscreen]:px-4 pointer-fine:@min-[24rem]:group-not-[:fullscreen]:pb-3 transition-opacity duration-300 focus-within:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none ${showControls || !playing ? 'opacity-100' : 'pointer-fine:@min-[24rem]:group-not-[:fullscreen]:opacity-0'}`}>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-on-media/20">
              <div className="absolute inset-y-0 left-0 bg-on-media/30" style={{ width: `${bufferedPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-on-media" style={{ width: `${progressPct}%` }} />
            </div>
            <input
              type="range"
              aria-label="Seek video"
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              min={0}
              max={duration}
              step="any"
              value={Math.min(currentTime, duration)}
              disabled={duration <= 0}
              onChange={(event) => seek(Number(event.currentTarget.value))}
              onKeyDown={(event) => {
                const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1
                  : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0
                if (!direction) return
                event.preventDefault()
                skip(direction * (event.shiftKey ? 5 : 1))
              }}
              className="pointer-events-auto relative block h-11 w-full cursor-pointer appearance-none rounded-md bg-transparent accent-on-media focus-visible:outline-2 focus-visible:outline-on-media [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-on-media [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-on-media"
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-on-media">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-between">
          <div className="flex items-center">
            <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className={controlClass}>
              {playing ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" fill="currentColor" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10 seconds" disabled={duration <= 0} className={controlClass}>
              <Undo2 className="size-4" aria-hidden="true" /><span className="text-[10px]" aria-hidden="true">10</span>
            </button>
            <button type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds" disabled={duration <= 0} className={controlClass}>
              <Redo2 className="size-4" aria-hidden="true" /><span className="text-[10px]" aria-hidden="true">10</span>
            </button>
            <button type="button" onClick={restart} aria-label="Restart" className={controlClass}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className={controlClass}>
              {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <div className="ml-auto flex items-center">
            <select aria-label="Playback speed" value={playbackRate} onChange={(event) => changeRate(Number(event.currentTarget.value))} className="h-11 min-w-[4.25rem] rounded-xl bg-media px-2 text-xs tabular-nums text-on-media focus-visible:outline-2 focus-visible:outline-on-media">
              {[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
            </select>
            <button type="button" onClick={toggleFullscreen} aria-label="Full screen" className={controlClass}>
              <Maximize className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
