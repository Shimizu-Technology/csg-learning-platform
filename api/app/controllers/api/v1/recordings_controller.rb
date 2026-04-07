module Api
  module V1
    class RecordingsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/recordings
      def index
        enrollment = current_user.enrollments.active.includes(:module_assignments, :lesson_assignments, cohort: { curriculum: { modules: { lessons: :content_blocks } } }).first

        unless enrollment
          render json: { recordings: [] }
          return
        end

        cohort = enrollment.cohort
        curriculum = cohort.curriculum
        assignments_by_module_id = enrollment.module_assignments.index_by(&:module_id)
        lesson_assignments_by_lesson_id = enrollment.lesson_assignments.index_by(&:lesson_id)

        recordings = curriculum.modules.includes(lessons: :content_blocks).flat_map do |mod|
          assignment = assignments_by_module_id[mod.id]
          next [] unless assignment.present?

          mod.lessons.flat_map do |lesson|
            lesson_assignment = lesson_assignments_by_lesson_id[lesson.id]
            available = lesson.available?(cohort, assignment, lesson_assignment)
            next [] unless available

            recording_blocks = lesson.content_blocks.select do |block|
              %w[video recording].include?(block.block_type) && block.video_url.present?
            end
            next [] if recording_blocks.empty?

            {
              module_id: mod.id,
              module_name: mod.name,
              lesson_id: lesson.id,
              lesson_title: lesson.title,
              lesson_type: lesson.lesson_type,
              release_day: lesson.release_day,
              unlock_date: lesson_assignment&.unlock_date_override || assignment&.unlock_date_override || lesson.unlock_date(cohort),
              recordings: recording_blocks.sort_by(&:position).map do |block|
                {
                  id: block.id,
                  title: block.title || lesson.title,
                  block_type: block.block_type,
                  video_url: block.video_url,
                  position: block.position
                }
              end
            }
          end
        end.sort_by { |entry| [ entry[:unlock_date] || Date.current, entry[:module_name], entry[:release_day] || 0, entry[:lesson_title] ] }

        render json: { recordings: recordings }
      end
    end
  end
end
