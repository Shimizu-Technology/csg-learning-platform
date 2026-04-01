module Api
  module V1
    class ResourcesController < ApplicationController
      before_action :authenticate_user!

      LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.freeze

      # GET /api/v1/resources
      def index
        enrollment = current_user.enrollments.active.includes(:module_assignments, :lesson_assignments, cohort: { curriculum: { modules: { lessons: :content_blocks } } }).first

        unless enrollment
          render json: { resources: [] }
          return
        end

        cohort = enrollment.cohort
        curriculum = cohort.curriculum
        assignments_by_module_id = enrollment.module_assignments.index_by(&:module_id)
        lesson_assignments_by_lesson_id = enrollment.lesson_assignments.index_by(&:lesson_id)

        resources = curriculum.modules.includes(lessons: :content_blocks).flat_map do |mod|
          assignment = assignments_by_module_id[mod.id]
          next [] unless assignment.present?

          mod.lessons.flat_map do |lesson|
            lesson_assignment = lesson_assignments_by_lesson_id[lesson.id]
            next [] unless lesson.available?(cohort, assignment, lesson_assignment)

            lesson.content_blocks.flat_map do |block|
              extract_links(block.body).map do |link|
                {
                  id: "#{lesson.id}-#{block.id}-#{Digest::MD5.hexdigest(link[:url])}",
                  title: link[:title],
                  url: link[:url],
                  module_id: mod.id,
                  module_name: mod.name,
                  lesson_id: lesson.id,
                  lesson_title: lesson.title,
                  content_block_id: block.id,
                  content_block_title: block.title,
                  unlock_date: lesson_assignment&.unlock_date_override || assignment&.unlock_date_override || lesson.unlock_date(cohort)
                }
              end
            end
          end
        end

        deduped = resources.uniq { |resource| resource[:url] }
        render json: { resources: deduped }
      end

      private

      def extract_links(content)
        return [] if content.blank?

        content.scan(LINK_REGEX).map do |title, url|
          {
            title: title.presence || url,
            url: url
          }
        end
      end
    end
  end
end
