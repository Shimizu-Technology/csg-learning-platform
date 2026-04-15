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
        progress.duration_seconds = params[:duration_seconds].to_i if params[:duration_seconds].present?

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
    end
  end
end
