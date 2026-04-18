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

        # find_or_initialize_by + save is not atomic: two concurrent first-ever
        # pings (the player kicks one off on play and another on its first
        # interval tick before the first one persists) both see no row, both
        # build a new one, and the second save raises ActiveRecord::RecordNotUnique
        # against index_watch_progresses_on_user_id_and_recording_id, surfacing
        # as an unrescued 500. Retry once after looking the row back up so the
        # second ping merges with the first.
        progress = upsert_watch_progress(recording)

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
      rescue ActiveRecord::RecordNotUnique
        progress = upsert_watch_progress(recording, force_existing: true)
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

        # All recordings the student is enrolled to see (active enrollments only),
        # so the UI can surface "not started" rows alongside touched ones rather
        # than just showing what they've already played.
        active_cohorts = user.enrollments.where(status: :active).map(&:cohort_id)
        all_recordings = Recording.where(cohort_id: active_cohorts).includes(:cohort).order(:cohort_id, :position)
        progress_by_recording = progresses.index_by(&:recording_id)

        render json: {
          watch_progresses: all_recordings.map { |r|
            wp = progress_by_recording[r.id]
            {
              recording_id: r.id,
              recording_title: r.title,
              cohort_id: r.cohort_id,
              cohort_name: r.cohort.name,
              last_position_seconds: wp&.last_position_seconds || 0,
              total_watched_seconds: wp&.total_watched_seconds || 0,
              duration_seconds: wp&.duration_seconds || r.duration_seconds,
              progress_percentage: wp&.progress_percentage || 0,
              completed: wp&.completed || false,
              last_watched_at: wp&.last_watched_at
            }
          }
        }
      end

      # GET /api/v1/watch_progress/student/:user_id/lesson_videos
      # Per-student progress for in-lesson S3 video blocks across the curricula
      # they're actively enrolled in.
      def student_lesson_video_progress
        require_staff!
        return if performed?

        user = User.find(params[:user_id])
        active_enrollments = user.enrollments.where(status: :active).includes(cohort: { curriculum: { modules: { lessons: :content_blocks } } })

        # `has_many :modules / :lessons / :content_blocks` already use
        # `-> { order(:position) }` scopes, so iterating the eager-loaded
        # associations is already in display order — no Ruby-side resort needed.
        rows = []
        active_enrollments.each do |enrollment|
          cohort = enrollment.cohort
          cohort.curriculum.modules.each do |mod|
            mod.lessons.each do |lesson|
              lesson.content_blocks.each do |cb|
                next unless (cb.block_type == "video" || cb.block_type == "recording") && cb.s3_video_key.present?
                rows << [ cb, mod, lesson, cohort ]
              end
            end
          end
        end

        block_ids = rows.map { |cb, _m, _l, _c| cb.id }
        progress_by_block = user.progresses.where(content_block_id: block_ids).index_by(&:content_block_id)

        render json: {
          lesson_videos: rows.map { |cb, mod, lesson, cohort|
            p = progress_by_block[cb.id]
            duration = cb.s3_video_duration_seconds
            pct = if duration&.positive? && p&.video_total_watched
              [ (p.video_total_watched.to_f / duration * 100).round(1), 100.0 ].min
            else
              0
            end
            {
              content_block_id: cb.id,
              title: cb.title.presence || lesson.title,
              lesson_title: lesson.title,
              module_title: mod.name,
              cohort_id: cohort.id,
              cohort_name: cohort.name,
              duration_seconds: duration,
              last_position_seconds: p&.video_last_position || 0,
              total_watched_seconds: p&.video_total_watched || 0,
              progress_percentage: pct,
              completed: p&.status == "completed",
              completed_at: p&.completed_at,
              # For video progresses, updated_at advances on every player ping,
              # so it's the most accurate "last touched" signal we have.
              last_watched_at: p&.updated_at
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
        # an attached S3 video — there's nothing to track for those. The eager-loaded
        # associations are already ordered by `position` via their `has_many` scopes.
        video_blocks = cohort.curriculum.modules.flat_map { |m|
          m.lessons.flat_map { |l|
            l.content_blocks
              .select { |cb| (cb.block_type == "video" || cb.block_type == "recording") && cb.s3_video_key.present? }
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

      private

      # Build the WatchProgress row to save and apply the param-derived fields
      # (capped last_position, capped total_watched, last_watched_at). Used by both the
      # initial save attempt and the post-RecordNotUnique retry. Pass
      # force_existing: true after a uniqueness collision to skip the build path
      # and reload the row the racing request just inserted.
      def upsert_watch_progress(recording, force_existing: false)
        progress = if force_existing
          current_user.watch_progresses.find_by!(recording: recording)
        else
          current_user.watch_progresses.find_or_initialize_by(recording: recording)
        end

        server_duration = recording.duration_seconds
        progress.duration_seconds = server_duration || params[:duration_seconds].to_i
        new_position = params[:last_position_seconds].to_i
        if progress.duration_seconds&.positive?
          new_position = [ new_position, progress.duration_seconds ].min
        end
        progress.last_position_seconds = [ new_position, 0 ].max

        new_watched = params[:total_watched_seconds].to_i
        if progress.duration_seconds&.positive?
          new_watched = [ new_watched, progress.duration_seconds ].min
        end
        progress.total_watched_seconds = [ progress.total_watched_seconds, new_watched ].max
        progress.last_watched_at = Time.current
        progress
      end
    end
  end
end
