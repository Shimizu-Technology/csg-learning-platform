module Api
  module V1
    class CohortsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_cohort, only: [ :show, :update, :destroy, :update_module_access, :update_announcements ]

      # GET /api/v1/cohorts
      def index
        cohorts = Cohort.includes(:curriculum).order(start_date: :desc)
        render json: {
          cohorts: cohorts.map { |c| cohort_json(c) }
        }
      end

      # GET /api/v1/cohorts/:id
      def show
        render json: {
          cohort: cohort_json(@cohort, include_students: true, include_modules: true)
        }
      end

      # POST /api/v1/cohorts
      def create
        cohort = Cohort.new(cohort_params)
        if cohort.save
          render json: { cohort: cohort_json(cohort) }, status: :created
        else
          render json: { errors: cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:id
      def update
        if @cohort.update(cohort_params)
          render json: { cohort: cohort_json(@cohort) }
        else
          render json: { errors: @cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:id/module_access
      def update_module_access
        curriculum_module = @cohort.curriculum.modules.find(module_access_params[:module_id])
        enrollments = @cohort.enrollments.active.includes(:module_assignments, :lesson_assignments)
        assigned = module_access_params[:assigned]
        lesson_ids = curriculum_module.lessons.pluck(:id)

        ActiveRecord::Base.transaction do
          enrollments.each do |enrollment|
            if assigned == false
              enrollment.lesson_assignments.where(lesson_id: lesson_ids).destroy_all
              enrollment.module_assignments.where(module_id: curriculum_module.id).destroy_all
              next
            end

            assignment = enrollment.module_assignments.find_or_initialize_by(module_id: curriculum_module.id)
            assignment.unlocked = module_access_params[:unlocked] unless module_access_params[:unlocked].nil?
            assignment.unlock_date_override = module_access_params[:unlock_date_override]
            assignment.save!
          end
        end

        render json: {
          cohort: cohort_json(@cohort.reload, include_students: true, include_modules: true)
        }
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: [ e.message ] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/cohorts/:id/announcements
      def update_announcements
        settings = (@cohort.settings || {}).deep_dup
        settings["announcements"] = normalize_announcements(params[:announcements])

        if @cohort.update(settings: settings)
          render json: {
            cohort: cohort_json(@cohort, include_students: true, include_modules: true)
          }
        else
          render json: { errors: @cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/cohorts/:id
      def destroy
        @cohort.destroy
        head :no_content
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:id])
      end

      def cohort_params
        params.permit(:name, :cohort_type, :curriculum_id, :start_date, :end_date,
                       :github_organization_name, :repository_name, :requires_github, :status, :settings)
      end

      def module_access_params
        params.permit(:module_id, :assigned, :unlocked, :unlock_date_override)
      end

      def normalize_announcements(raw_announcements)
        Array(raw_announcements).map do |announcement|
          next unless announcement.is_a?(ActionController::Parameters) || announcement.is_a?(Hash)

          item = announcement.to_h.symbolize_keys.slice(:title, :body, :pinned, :published_at)
          next if item[:title].blank? && item[:body].blank?

          {
            title: item[:title].to_s.strip,
            body: item[:body].to_s.strip,
            pinned: ActiveModel::Type::Boolean.new.cast(item[:pinned]),
            published_at: item[:published_at].presence || Time.current.iso8601
          }
        end.compact
      end

      def cohort_json(cohort, include_students: false, include_modules: false)
        json = {
          id: cohort.id,
          name: cohort.name,
          cohort_type: cohort.cohort_type,
          curriculum_id: cohort.curriculum_id,
          curriculum_name: cohort.curriculum.name,
          start_date: cohort.start_date,
          end_date: cohort.end_date,
          github_organization_name: cohort.github_organization_name,
          repository_name: cohort.repository_name,
          requires_github: cohort.requires_github,
          status: cohort.status,
          settings: cohort.settings,
          enrolled_count: cohort.enrollments.count,
          active_count: cohort.enrollments.active.count,
          announcements: Array((cohort.settings || {})["announcements"])
        }

        if include_students
          json[:students] = cohort.enrollments.includes(:user, module_assignments: :curriculum_module).map { |e|
            {
              enrollment_id: e.id,
              user_id: e.user.id,
              full_name: e.user.full_name,
              email: e.user.email,
              github_username: e.user.github_username,
              status: e.status,
              enrolled_at: e.enrolled_at,
              last_sign_in_at: e.user.last_sign_in_at,
              module_assignments: e.module_assignments.map { |assignment|
                {
                  id: assignment.id,
                  module_id: assignment.module_id,
                  module_name: assignment.curriculum_module.name,
                  unlocked: assignment.unlocked,
                  unlock_date_override: assignment.unlock_date_override
                }
              }
            }
          }
        end

        if include_modules
          active_enrollments = cohort.enrollments.active.includes(:module_assignments)
          assignment_index = active_enrollments.each_with_object(Hash.new { |h, k| h[k] = [] }) do |enrollment, hash|
            enrollment.module_assignments.each { |assignment| hash[assignment.module_id] << assignment }
          end

          json[:modules] = cohort.curriculum.modules.map do |mod|
            assignments = assignment_index[mod.id]
            {
              id: mod.id,
              name: mod.name,
              module_type: mod.module_type,
              position: mod.position,
              lessons_count: mod.lessons.count,
              assigned_count: assignments.size,
              assigned: assignments.size.positive?,
              unlocked_count: assignments.count(&:unlocked?),
              unlock_date_overrides: assignments.map(&:unlock_date_override).compact.uniq.sort
            }
          end
        end

        json
      end
    end
  end
end
