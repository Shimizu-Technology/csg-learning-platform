module Api
  module V1
    class CohortsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :show ]
      before_action :require_admin!, except: [ :index, :show ]
      before_action :set_cohort, only: [ :show, :update, :destroy, :module_access, :announcements, :recordings, :class_resources ]

      # GET /api/v1/cohorts
      def index
        cohorts = Cohort.includes(curriculum: :modules).order(start_date: :desc)
        render json: {
          cohorts: cohorts.map { |c|
            base = cohort_json(c)
            base[:modules] = c.curriculum.modules.order(:position).map { |m| { id: m.id, name: m.name } }
            base
          }
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
      def module_access
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

          permitted = module_access_params
          if permitted.key?(:requires_github) || permitted.key?(:repository_name)
            settings = (@cohort.settings || {}).deep_dup
            config = settings["module_github_config"] ||= {}
            mod_config = config[curriculum_module.id.to_s] ||= {}
            mod_config["requires_github"] = ActiveModel::Type::Boolean.new.cast(permitted[:requires_github]) if permitted.key?(:requires_github)
            mod_config["repository_name"] = permitted[:repository_name].to_s.strip if permitted.key?(:repository_name)
            @cohort.update!(settings: settings)
          end
        end

        render json: {
          cohort: cohort_json(@cohort.reload, include_students: true, include_modules: true)
        }
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: [ e.message ] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/cohorts/:id/announcements
      def announcements
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

      # PATCH /api/v1/cohorts/:id/recordings
      def recordings
        settings = (@cohort.settings || {}).deep_dup
        settings["recordings"] = normalize_recordings(params[:recordings])

        if @cohort.update(settings: settings)
          render json: {
            cohort: cohort_json(@cohort, include_students: true, include_modules: true)
          }
        else
          render json: { errors: @cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:id/class_resources
      def class_resources
        settings = (@cohort.settings || {}).deep_dup
        settings["class_resources"] = normalize_class_resources(params[:class_resources])

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
        params.permit(:module_id, :assigned, :unlocked, :unlock_date_override, :requires_github, :repository_name)
      end

      def param_to_hash(param)
        if param.is_a?(ActionController::Parameters)
          param.permit(:title, :body, :pinned, :published_at, :url, :date,
                       :description, :category).to_h.symbolize_keys
        elsif param.is_a?(Hash)
          param.symbolize_keys
        end
      end

      def normalize_announcements(raw_announcements)
        Array(raw_announcements).filter_map do |announcement|
          item = param_to_hash(announcement)
          next if item.nil?

          item = item.slice(:title, :body, :pinned, :published_at)
          next if item[:title].blank? && item[:body].blank?

          {
            title: item[:title].to_s.strip,
            body: item[:body].to_s.strip,
            pinned: ActiveModel::Type::Boolean.new.cast(item[:pinned]),
            published_at: item[:published_at].presence || Time.current.iso8601
          }
        end
      end

      def normalize_recordings(raw_recordings)
        Array(raw_recordings).filter_map do |recording|
          item = param_to_hash(recording)
          next if item.nil?

          item = item.slice(:title, :url, :date, :description)
          next if item[:title].blank? && item[:url].blank?

          {
            title: item[:title].to_s.strip,
            url: item[:url].to_s.strip,
            date: item[:date].to_s.strip.presence,
            description: item[:description].to_s.strip.presence
          }
        end
      end

      def normalize_class_resources(raw_resources)
        Array(raw_resources).filter_map do |resource|
          item = param_to_hash(resource)
          next if item.nil?

          item = item.slice(:title, :url, :category, :description)
          next if item[:title].blank? && item[:url].blank?

          {
            title: item[:title].to_s.strip,
            url: item[:url].to_s.strip,
            category: item[:category].to_s.strip.presence || "general",
            description: item[:description].to_s.strip.presence
          }
        end
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
          announcements: Array((cohort.settings || {})["announcements"]),
          recordings: Array((cohort.settings || {})["recordings"]),
          class_resources: Array((cohort.settings || {})["class_resources"])
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
              invite_pending: e.user.clerk_id&.start_with?("pending_") || false,
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

          github_config = (cohort.settings || {}).dig("module_github_config") || {}

          json[:modules] = cohort.curriculum.modules.map do |mod|
            assignments = assignment_index[mod.id]
            mod_gh = github_config[mod.id.to_s] || {}
            {
              id: mod.id,
              name: mod.name,
              module_type: mod.module_type,
              position: mod.position,
              lessons_count: mod.lessons.count,
              assigned_count: assignments.size,
              assigned: assignments.size.positive?,
              unlocked_count: assignments.count(&:unlocked?),
              accessible_count: assignments.count(&:accessible?),
              unlock_date_overrides: assignments.map(&:unlock_date_override).compact.uniq.sort,
              requires_github: mod_gh["requires_github"] || false,
              repository_name: mod_gh["repository_name"].presence || cohort.repository_name
            }
          end
        end

        json
      end
    end
  end
end
