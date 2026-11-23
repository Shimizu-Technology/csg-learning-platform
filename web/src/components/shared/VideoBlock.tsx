import { SegmentedControl, SegmentButton } from '../ui/Choice'
import { getYouTubeId, getVimeoEmbed } from '../../lib/videoUrls'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { ContentBlockController } from './useContentBlockController'
import { VideoPlayer } from './VideoPlayer'
import { VideoSegmentControls } from './VideoSegmentControls'

export function VideoBlock({ controller, ...props }: ContentBlockRendererProps & { controller: ContentBlockController }) {
  const { activeVideoSegment, completedRanges, saveNotice, rejectedSection, retryProgress, onPlaybackSample, vimeoContainerRef, ytIframeRef, s3VideoRef, videoSegments, initialVideoPosition, finishActiveVideoSegment, fetchBlockStreamUrl, onSaveProgress, handleVideoSegmentSelect } = controller
  const { block, isStaff, readOnly } = props
  const sources = block.video_progress_sources
  // Preserve the element while the learner switches between known versions.
  // When the lesson refreshes with different files, never keep playing an
  // old stream against the new source identity.
  const hostedKey = JSON.stringify([block.id, props.cohortId, block.s3_video_key, sources?.default, Object.entries(sources?.versions ?? {}).sort()])
  return (
    <>
      {controller.versions.length >= 2 && (
        <SegmentedControl label="Video version" className="mb-3">
          {controller.versions.map((version) => <SegmentButton key={version.id} selected={controller.versionId === version.id} onClick={() => controller.selectVideoVersion(version.id)}>{version.label}</SegmentButton>)}
        </SegmentedControl>
      )}
      {(block.block_type === 'video' || block.block_type === 'recording') && block.s3_video_key && (
        <VideoPlayer
          ref={s3VideoRef}
          key={hostedKey}
          title={block.title || 'Video'}
          initialPosition={initialVideoPosition}
          initialTotalWatched={block.progress?.video_total_watched || 0}
          fetchStreamUrl={fetchBlockStreamUrl}
          onSaveProgress={onSaveProgress}
          onPlaybackSample={onPlaybackSample}
          stopAtSeconds={activeVideoSegment?.end_seconds ?? null}
          onStopAtReached={finishActiveVideoSegment}
          trackProgress={!isStaff && !readOnly}
          anchorProgress={!!sources?.default}
        />
      )}

      {block.block_type === 'video' && block.video_url && !block.s3_video_key && (
        <div className="aspect-video rounded-xl overflow-hidden bg-media">
          {(() => {
            const ytId = getYouTubeId(block.video_url!)
            if (ytId) {
              return (
                <iframe
                  ref={ytIframeRef}
                  src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${typeof window === 'undefined' ? '' : window.location.origin}&start=${initialVideoPosition}`}
                  className="w-full h-full"
                  title={block.title || "YouTube video"}
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              )
            }
            const vimeo = getVimeoEmbed(block.video_url!)
            if (vimeo) {
              return <div ref={vimeoContainerRef} className="w-full h-full" />
            }
            return (
              <div className="flex items-center justify-center h-full text-on-media">
                <a href={sanitizeUrl(block.video_url!)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-on-media underline underline-offset-4">
                  Open video
                </a>
              </div>
            )
          })()}
        </div>
      )}

      {block.block_type === 'recording' && block.video_url && !block.s3_video_key && (
        <div className="aspect-video rounded-xl overflow-hidden bg-media">
          {(() => {
            const ytId = getYouTubeId(block.video_url!)
            if (ytId) {
              return (
                <iframe
                  ref={ytIframeRef}
                  src={`https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${typeof window === 'undefined' ? '' : window.location.origin}&start=${initialVideoPosition}`}
                  className="w-full h-full"
                  title={block.title || "YouTube video"}
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              )
            }
            const vimeo = getVimeoEmbed(block.video_url!)
            if (vimeo) {
              return <div ref={vimeoContainerRef} className="w-full h-full" />
            }
            return null
          })()}
        </div>
      )}

      {(block.block_type === 'video' || block.block_type === 'recording') && (
        <VideoSegmentControls segments={videoSegments} activeSegment={activeVideoSegment} completedRanges={completedRanges} onSelect={handleVideoSegmentSelect} />
      )}
      {rejectedSection && <p role="status" className="mt-2 text-sm text-ink-secondary">A section could not be confirmed. Reload the lesson to check its current timestamps.</p>}
      {saveNotice && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
        <p role="status">{{
          retry: 'Recording progress could not be saved.',
          waiting: 'Your watch time is still syncing.',
          stale: 'The recording or class access changed. Reload the lesson before saving.',
        }[saveNotice]}</p>
        {(saveNotice === 'retry' || saveNotice === 'waiting') && (
          <button type="button" className="min-h-11 rounded-lg px-2 font-semibold underline" onClick={retryProgress}>Retry saving progress</button>
        )}
      </div>}
    </>
  )
}
