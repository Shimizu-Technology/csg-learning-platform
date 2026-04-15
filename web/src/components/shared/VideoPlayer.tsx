import { useEffect, useRef, useState, useCallback } from 'react'
import { Play, Pause, Maximize, Volume2, VolumeX, RotateCcw } from 'lucide-react'
import { api } from '../../lib/api'

interface VideoPlayerProps {
  cohortId: number
  recordingId: number
  title: string
  initialPosition?: number
  onProgressUpdate?: (data: { completed: boolean; progress_percentage: number }) => void
}

export function VideoPlayer({ cohortId, recordingId, title, initialPosition = 0, onProgressUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const totalWatchedRef = useRef(0)

  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.getRecordingStreamUrl(cohortId, recordingId).then((res) => {
      if (res.data?.stream_url) {
        setStreamUrl(res.data.stream_url)
      } else {
        setError('Failed to load video')
      }
      setLoading(false)
    })
  }, [cohortId, recordingId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return

    const handleLoaded = () => {
      setDuration(video.duration)
      if (initialPosition > 0) {
        video.currentTime = initialPosition
      }
    }
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    const handlePlay = () => setPlaying(true)
    const handlePause = () => setPlaying(false)
    const handleEnded = () => {
      setPlaying(false)
      sendProgress(true)
    }

    video.addEventListener('loadedmetadata', handleLoaded)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoaded)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
    }
  }, [streamUrl, initialPosition])

  // Track total watched time in 1-second increments while playing
  useEffect(() => {
    if (playing) {
      progressIntervalRef.current = setInterval(() => {
        totalWatchedRef.current += 1
      }, 1000)
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current)
        progressIntervalRef.current = null
      }
    }
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
    }
  }, [playing])

  // Send progress every 10 seconds while playing
  useEffect(() => {
    if (!playing) return
    const interval = setInterval(() => sendProgress(false), 10000)
    return () => clearInterval(interval)
  }, [playing, recordingId])

  // Send progress on unmount
  useEffect(() => {
    return () => { sendProgress(false) }
  }, [recordingId])

  const sendProgress = useCallback((ended: boolean) => {
    const video = videoRef.current
    if (!video || !video.duration) return

    const data = {
      recording_id: recordingId,
      last_position_seconds: Math.floor(ended ? video.duration : video.currentTime),
      total_watched_seconds: totalWatchedRef.current,
      duration_seconds: Math.floor(video.duration),
    }

    api.updateWatchProgress(data).then((res) => {
      if (res.data?.watch_progress && onProgressUpdate) {
        onProgressUpdate(res.data.watch_progress)
      }
    })
  }, [recordingId, onProgressUpdate])

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
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) document.exitFullscreen()
    else container.requestFullscreen()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    video.currentTime = pct * duration
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
    video.currentTime = 0
    video.play()
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
      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-900" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-white/30 border-t-white rounded-full" />
        </div>
      </div>
    )
  }

  if (error || !streamUrl) {
    return (
      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-900" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
          {error || 'Video unavailable'}
        </div>
      </div>
    )
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl bg-black group"
      style={{ paddingBottom: '56.25%' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { if (playing) setShowControls(false) }}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        className="absolute inset-0 w-full h-full object-contain"
        onClick={togglePlay}
        playsInline
        preload="metadata"
        title={title}
      />

      {/* Big play button overlay */}
      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity"
        >
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
            <Play className="h-8 w-8 sm:h-10 sm:w-10 text-slate-900 ml-1" fill="currentColor" />
          </div>
        </button>
      )}

      {/* Controls bar */}
      <div className={`absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent pt-10 pb-3 px-3 sm:px-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        {/* Progress bar */}
        <div
          className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer mb-3 group/progress"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-primary-500 rounded-full relative transition-all"
            style={{ width: `${progressPct}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button onClick={togglePlay} className="text-white/90 hover:text-white p-1">
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" fill="currentColor" />}
            </button>
            <button onClick={restart} className="text-white/70 hover:text-white p-1">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button onClick={toggleMute} className="text-white/70 hover:text-white p-1">
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <span className="text-xs text-white/70 ml-1 tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white p-1">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
