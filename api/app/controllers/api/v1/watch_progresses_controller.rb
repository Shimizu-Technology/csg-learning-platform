module Api
  module V1
    class WatchProgressesController < ApplicationController
      before_action :authenticate_user!

      # PATCH /api/v1/watch_progress
      def update
        recording = Recording.find(params[:recording_id])

        unless current_user.staff? || current_user.enrollments.exists?(cohort: recording.cohort, status: :active)
          render_forbidden("Not enrolled in this cohort")
          return
        end

        progress = current_user.watch_progresses.find_or_initialize_by(recording: recording)
        progress.last_position_seconds = params[:last_position_seconds].to_i
        server_duration = recording.duration_seconds
        progress.duration_seconds = server_duration || params[:duration_seconds].to_i

        new_watched = params[:total_watched_seconds].to_i
        progress.total_watched_seconds = [ progress.total_watched_seconds, new_watched ].max
        progress.last_watched_at = Time.current

        if progress.save
          render json: {
            watch_progress: {
              recording_id: progress.recording_id,
              last_position_seconds: progress.last_position_seconds,
              total_watched_seconds: progress.total_watched_seconds,
              progress_percentage: progress.progress_percentage,
              completed: progress.completed,
              last_watched_at: progress.last_watched_at
            }
          }
        else
          render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # GET /api/v1/watch_progress/student/:user_id
      def student_progress
        require_staff!
        return if performed?

        user = User.find(params[:user_id])
        progresses = user.watch_progresses.includes(recording: :cohort)

        render json: {
          watch_progresses: progresses.map { |wp|
            {
              recording_id: wp.recording_id,
              recording_title: wp.recording.title,
              cohort_name: wp.recording.cohort.name,
              last_position_seconds: wp.last_position_seconds,
              total_watched_seconds: wp.total_watched_seconds,
              duration_seconds: wp.duration_seconds,
              progress_percentage: wp.progress_percentage,
              completed: wp.completed,
              last_watched_at: wp.last_watched_at
            }
          }
        }
      end

      # GET /api/v1/cohorts/:cohort_id/watch_progress
      def cohort_progress
        require_staff!
        return if performed?

        cohort = Cohort.find(params[:cohort_id])
        recordings = cohort.recordings.ordered
        enrollments = cohort.enrollments.active.includes(:user)

        progress_data = WatchProgress
          .where(recording: recordings, user: enrollments.map(&:user))
          .index_by { |wp| [ wp.user_id, wp.recording_id ] }

        render json: {
          recordings: recordings.map { |r| { id: r.id, title: r.title, duration_seconds: r.duration_seconds } },
          students: enrollments.map { |e|
            {
              user_id: e.user_id,
              full_name: e.user.full_name,
              recordings: recordings.map { |r|
                wp = progress_data[[ e.user_id, r.id ]]
                {
                  recording_id: r.id,
                  progress_percentage: wp&.progress_percentage || 0,
                  completed: wp&.completed || false,
                  total_watched_seconds: wp&.total_watched_seconds || 0
                }
              }
            }
          }
        }
      end

      # GET /api/v1/cohorts/:cohort_id/lesson_video_progress
      # Per-student watch matrix for in-lesson S3 videos (content blocks of type
      # video or recording with an s3_video_key) across the cohort's curriculum.
      def cohort_lesson_video_progress
        require_staff!
        return if performed?

        cohort = Cohort.includes(curriculum: { modules: { lessons: :content_blocks } }).find(params[:cohort_id])
        enrollments = cohort.enrollments.active.includes(:user)

        # Flatten the curriculum into ordered video blocks once. Skip blocks without
        # an attached S3 video — there's nothing to track for those.
        video_blocks = cohort.curriculum.modules
          .sort_by(&:position)
          .flat_map { |m|
            m.lessons.sort_by(&:position).flat_map { |l|
              l.content_blocks
                .select { |cb| (cb.block_type == "video" || cb.block_type == "recording") && cb.s3_video_key.present? }
                .sort_by(&:position)
                .map { |cb| [ cb, m, l ] }
            }
          }

        block_ids = video_blocks.map { |cb, _m, _l| cb.id }
        progress_data = Progress
          .where(content_block_id: block_ids, user: enrollments.map(&:user))
          .index_by { |p| [ p.user_id, p.content_block_id ] }

        render json: {
          videos: video_blocks.map { |cb, m, l|
            {
              id: cb.id,
              title: cb.title.presence || l.title,
              lesson_title: l.title,
              module_title: m.name,
              duration_seconds: cb.s3_video_duration_seconds
            }
          },
          students: enrollments.map { |e|
            {
              user_id: e.user_id,
              full_name: e.user.full_name,
              videos: video_blocks.map { |cb, _m, _l|
                p = progress_data[[ e.user_id, cb.id ]]
                duration = cb.s3_video_duration_seconds
                pct = if duration&.positive? && p&.video_total_watched
                  [ (p.video_total_watched.to_f / duration * 100).round(1), 100.0 ].min
                else
                  0
                end
                {
                  content_block_id: cb.id,
                  progress_percentage: pct,
                  completed: p&.status == "completed",
                  total_watched_seconds: p&.video_total_watched || 0
                }
              }
            }
          }
        }
      end
    end
  end
end
