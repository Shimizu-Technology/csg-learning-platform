import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import type { ContentBlockController } from './useContentBlockController'
import { VideoPlayer } from './VideoPlayer'
import { VideoSegmentControls } from './VideoSegmentControls'
function getYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function getVimeoEmbed(url: string): { id: string; hash?: string } | null {
  const match = url.match(/vimeo\.com\/(\d+)(?:\/([a-zA-Z0-9]+))?/) 
  if (!match) return null
  return { id: match[1], hash: match[2] }
}


export function VideoBlock({ controller, ...props }: ContentBlockRendererProps & { controller: ContentBlockController }) {
  const { activeVideoSegment, completedVideoSegment, vimeoContainerRef, ytIframeRef, s3VideoRef, videoSegments, initialVideoPosition, finishActiveVideoSegment, fetchBlockStreamUrl, saveBlockProgress, handleVideoSegmentSelect } = controller
  const { block, isStaff, readOnly } = props
  return <>
        {(block.block_type === 'video' || block.block_type === 'recording') && block.s3_video_key && (
          <VideoPlayer
            ref={s3VideoRef}
            key={`s3-${block.id}`}
            title={block.title || 'Video'}
            initialPosition={initialVideoPosition}
            initialTotalWatched={block.progress?.video_total_watched || 0}
            fetchStreamUrl={fetchBlockStreamUrl}
            onSaveProgress={saveBlockProgress}
            stopAtSeconds={activeVideoSegment?.end_seconds ?? null}
            onStopAtReached={finishActiveVideoSegment}
            trackProgress={!isStaff && !readOnly}
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
                    allowFullScreen
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
          <VideoSegmentControls segments={videoSegments} activeSegment={activeVideoSegment} completedSegment={completedVideoSegment} onSelect={handleVideoSegmentSelect} />
        )}


  </>
}
