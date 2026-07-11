module Api
  module V1
    class CohortsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :show, :student_view ]
      before_action :require_admin!, except: [ :index, :show, :student_view ]
      before_action :set_cohort, only: [ :show, :update, :destroy, :module_access, :announcements, :recordings, :class_resources ]
      before_action :set_cohort_with_lessons, only: [ :student_view ]

      # GET /api/v1/cohorts
      def index
        cohorts = Cohort.includes(
          :cohort_module_schedules,
          :cohort_module_submission_windows,
          { office_hours: :created_by },
          curriculum: :modules
        ).order(start_date: :desc)
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

      # GET /api/v1/cohorts/:id/student_view
      def student_view
        render json: {
          student_view: cohort_student_view_json(@cohort)
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
          render json: { cohort: cohort_json(@cohort, include_students: true, include_modules: true) }
        else
          render json: { errors: @cohort.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:id/module_access
      def module_access
        curriculum_module = @cohort.curriculum.modules.find(module_access_params[:module_id])
        enrollments = @cohort.enrollments.active.includes(:module_assignments, :lesson_assignments)
        assigned = module_access_params[:assigned]
        schedule_exists = @cohort.cohort_module_schedules.any? { |schedule| schedule.module_id == curriculum_module.id }
        assignments_exist = enrollments.any? do |enrollment|
          enrollment.module_assignments.any? { |assignment| assignment.module_id == curriculum_module.id }
        end
        module_already_assigned = schedule_exists || assignments_exist
        lesson_ids = curriculum_module.lessons.map(&:id)
        module_start_date = normalized_module_start_date
        return if performed?
        if assigned.nil? && !module_already_assigned
          render json: { errors: [ "Module must be assigned before it can be updated" ] }, status: :unprocessable_entity
          return
        end

        ActiveRecord::Base.transaction do
          enrollments.each do |enrollment|
            if assigned == false
              enrollment.lesson_assignments.where(lesson_id: lesson_ids).destroy_all
              enrollment.module_assignments.where(module_id: curriculum_module.id).destroy_all
              next
            end

            assignment = enrollment.module_assignments.find_or_initialize_by(module_id: curriculum_module.id)
            assignment.unlocked = module_access_params[:unlocked] unless module_access_params[:unlocked].nil?
            assignment.save!
          end

          if assigned == false
            @cohort.cohort_module_schedules.where(module_id: curriculum_module.id).destroy_all
          elsif assigned == true || module_already_assigned
            schedule = @cohort.cohort_module_schedules.find_or_initialize_by(module_id: curriculum_module.id)
            schedule.start_date = module_start_date || schedule.start_date || curriculum_module.next_start_date_on_or_after(Date.current)
            schedule.save!
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
          cohort: cohort_json(load_cohort_for_detail(@cohort.id), include_students: true, include_modules: true)
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
        @cohort = load_cohort_for_detail(params[:id])
      end

      def load_cohort_for_detail(id)
        Cohort.includes(
          :cohort_module_schedules,
          :cohort_module_submission_windows,
          { office_hours: :created_by },
          curriculum: { modules: :lessons }
        ).find(id)
      end

      def set_cohort_with_lessons
        @cohort = Cohort.includes(
          :cohort_module_schedules,
          :cohort_module_submission_windows,
          { office_hours: :created_by },
          curriculum: { modules: { lessons: :content_blocks } }
        ).find(params[:id])
      end

      def cohort_params
        params.permit(:name, :cohort_type, :curriculum_id, :start_date, :end_date,
                       :github_organization_name, :repository_name, :requires_github, :status, :settings)
      end

      def module_access_params
        params.permit(:module_id, :assigned, :unlocked, :module_start_date, :unlock_date_override, :requires_github, :repository_name)
      end

      def normalized_module_start_date
        raw = if params.key?(:module_start_date)
          params[:module_start_date]
        elsif params.key?(:unlock_date_override)
          params[:unlock_date_override]
        end

        return nil if raw.blank?

        Date.iso8601(raw.to_s)
      rescue ArgumentError
        render json: { errors: [ "Module start date is invalid" ] }, status: :unprocessable_entity
        nil
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

      def cohort_student_view_json(cohort)
        modules = cohort.curriculum.modules.sort_by(&:position)
        schedule_index = cohort.cohort_module_schedules.index_by(&:module_id)
        active_enrollments = cohort.enrollments.active.includes(module_assignments: :curriculum_module).to_a
        assignment_index = active_enrollments.each_with_object(Hash.new { |hash, key| hash[key] = [] }) do |enrollment, hash|
          enrollment.module_assignments.each { |assignment| hash[assignment.module_id] << assignment }
        end
        github_config = (cohort.settings || {}).dig("module_github_config") || {}
        module_data = modules.map do |mod|
          cohort_student_view_module_json(cohort, mod, schedule_index[mod.id], assignment_index[mod.id], github_config[mod.id.to_s] || {})
        end

        visible_lessons = module_data.sum { |mod| mod[:visible_lessons_count] }
        total_lessons = module_data.sum { |mod| mod[:lessons_count] }
        available_modules = module_data.count { |mod| mod[:available] }
        announcements = cohort_student_view_announcements(cohort)
        resources = cohort_student_view_resources(cohort)
        office_hours = OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(cohort), limit: 3)
        dashboard = cohort_student_dashboard_preview_json(cohort, module_data, announcements, resources, office_hours)

        {
          cohort: {
            id: cohort.id,
            name: cohort.name,
            status: cohort.status,
            start_date: cohort.start_date,
            end_date: cohort.end_date,
            curriculum_name: cohort.curriculum.name,
            active_count: active_enrollments.size
          },
          read_only: true,
          generated_at: Time.current.iso8601,
          summary: {
            assigned_modules: module_data.count { |mod| mod[:assigned] },
            available_modules: available_modules,
            locked_modules: module_data.count { |mod| mod[:assigned] && !mod[:available] },
            total_lessons: total_lessons,
            visible_lessons: visible_lessons,
            locked_lessons: total_lessons - visible_lessons
          },
          modules: module_data,
          dashboard: dashboard,
          announcements: announcements,
          resources: resources,
          office_hours: office_hours,
          recordings: {
            uploaded_count: cohort.recordings.count,
            legacy_count: Array((cohort.settings || {})["recordings"]).size,
            items: cohort_student_view_recordings(cohort)
          }
        }
      end

      def cohort_student_dashboard_preview_json(cohort, module_data, announcements, resources, office_hours)
        dashboard_modules = module_data.select { |mod| mod[:assigned] }.map do |mod|
          total_blocks = mod[:lessons].sum { |lesson| lesson[:completion_blocks_count] }
          {
            id: mod[:id],
            name: mod[:name],
            module_type: mod[:module_type],
            position: mod[:position],
            total_blocks: total_blocks,
            completed_blocks: 0,
            progress_percentage: 0,
            assigned: mod[:assigned],
            unlocked: mod[:available],
            available: mod[:available],
            unlock_date: mod[:module_start_date],
            lessons: mod[:lessons].map { |lesson|
              {
                id: lesson[:id],
                title: lesson[:title],
                lesson_type: lesson[:lesson_type],
                release_day: lesson[:release_day],
                required: lesson[:required],
                available: lesson[:available],
                unlock_date: lesson[:unlock_date],
                total_blocks: lesson[:completion_blocks_count],
                completed_blocks: 0,
                completed: false,
                submission_window: lesson[:submission_window]
              }
            }
          }
        end
        total_blocks = dashboard_modules.sum { |mod| mod[:total_blocks] }
        continue_lesson = dashboard_modules.flat_map { |mod| mod[:lessons] }.find { |lesson| lesson[:available] }

        {
          enrolled: true,
          user: { id: 0, full_name: "Student Preview", role: "student" },
          cohort: {
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            status: cohort.status,
            announcements: announcements,
            unread_notifications_count: announcements.size
          },
          overall_progress: { completed: 0, total: total_blocks, percentage: 0 },
          modules: dashboard_modules,
          continue_lesson: continue_lesson && { id: continue_lesson[:id], title: continue_lesson[:title] },
          action_items: [],
          resources: resources,
          office_hours: office_hours
        }
      end

      def cohort_student_view_module_json(cohort, mod, schedule, assignments, module_github_config)
        assigned = schedule.present? || assignments.any?
        start_date = cohort_student_view_module_start_date(cohort, mod, schedule, assignments, assigned)
        module_available = assigned && cohort_student_view_module_available?(cohort, assignments, start_date)
        requires_github = module_github_config["requires_github"] || false
        lesson_data = mod.lessons.sort_by(&:position).map do |lesson|
          cohort_student_view_lesson_json(cohort, mod, lesson, start_date, module_available, requires_github)
        end

        {
          id: mod.id,
          name: mod.name,
          module_type: mod.module_type,
          position: mod.position,
          assigned: assigned,
          available: module_available,
          module_start_date: start_date,
          repository_name: module_github_config["repository_name"].presence || cohort.repository_name,
          requires_github: requires_github,
          lessons_count: lesson_data.size,
          visible_lessons_count: lesson_data.count { |lesson| lesson[:available] },
          locked_lessons_count: lesson_data.count { |lesson| !lesson[:available] },
          lessons: lesson_data
        }
      end

      def cohort_student_view_module_start_date(cohort, mod, schedule, assignments, assigned)
        return schedule.start_date if schedule.present?

        assignment_start_date = assignments.filter_map { |assignment| assignment.effective_start_date(cohort) }.min
        return assignment_start_date if assignment_start_date.present?

        assigned ? mod.legacy_start_date_for(cohort) : nil
      end

      def cohort_student_view_module_available?(_cohort, assignments, start_date)
        return false unless start_date.present?
        return true if assignments.any?(&:unlocked?)

        Date.current >= start_date
      end

      def cohort_student_view_lesson_json(cohort, mod, lesson, module_start_date, module_available, requires_github)
        unlock_date = module_start_date.present? ? module_start_date + mod.calendar_offset_for(lesson.release_day) : nil
        available = module_available && unlock_date.present? && Date.current >= unlock_date

        {
          id: lesson.id,
          title: lesson.title,
          lesson_type: lesson.lesson_type,
          position: lesson.position,
          release_day: lesson.release_day,
          required: lesson.required,
          unlock_date: unlock_date,
          available: available,
          content_blocks_count: lesson.content_blocks.size,
          completion_blocks_count: lesson.completion_block_ids.size,
          requires_submission: lesson.effective_requires_submission(requires_github: requires_github),
          submission_type: lesson.effective_submission_type(requires_github: requires_github),
          submission_window: SubmissionWindowStatus.for_lesson(cohort: cohort, lesson: lesson)
        }
      end

      def cohort_student_view_announcements(cohort)
        Announcement.visible_now.includes(:author, :cohort)
                    .where(
                      "audience = :global OR (audience = :cohort AND cohort_id = :cohort_id)",
                      global: Announcement.audiences[:global],
                      cohort: Announcement.audiences[:cohort],
                      cohort_id: cohort.id
                    )
                    .ordered
                    .limit(10)
                    .map do |announcement|
          cohort_student_view_announcement_json(announcement)
        end
      end

      def cohort_student_view_announcement_json(announcement)
          {
            id: announcement.id,
            title: announcement.title,
            body: announcement.body,
            pinned: announcement.pinned,
            audience: announcement.audience,
            status: announcement.status,
            cohort_id: announcement.cohort_id,
            cohort_name: announcement.cohort&.name,
            published_at: announcement.published_at,
            author: announcement.author && {
              id: announcement.author.id,
              full_name: announcement.author.full_name,
              email: announcement.author.email
            }
          }
      end

      def cohort_student_view_resources(cohort)
        Array((cohort.settings || {})["class_resources"]).map.with_index do |resource, index|
          {
            id: index + 1,
            title: resource["title"],
            url: resource["url"],
            category: resource["category"] || "general",
            description: resource["description"]
          }
        end
      end

      def module_submission_windows_json(cohort, mod, module_start_date)
        (1..mod.week_count).map do |week_number|
          SubmissionWindowStatus.for_week(
            cohort: cohort,
            curriculum_module: mod,
            week_number: week_number,
            module_start_date: module_start_date
          )
        end
      end

      def cohort_student_view_recordings(cohort)
        uploaded = cohort.recordings.order(:position, :recorded_date, :created_at).limit(6).map do |recording|
          {
            id: recording.id,
            title: recording.title,
            description: recording.description,
            source: "uploaded",
            recorded_date: recording.recorded_date,
            duration_display: recording.duration_display
          }
        end
        legacy = Array((cohort.settings || {})["recordings"]).first(6).map.with_index do |recording, index|
          {
            id: "legacy-#{index}",
            title: recording["title"],
            description: recording["description"],
            source: recording["url"].to_s.include?("youtube") ? "youtube" : "external",
            url: recording["url"],
            date: recording["date"]
          }
        end

        (uploaded + legacy).first(8)
      end

      def cohort_json(cohort, include_students: false, include_modules: false)
        active_office_hours = OfficeHourSerializer.active_for(cohort)
        office_hours_payload = OfficeHourSerializer.collection_json(active_office_hours)
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
          enrolled_count: cohort.enrollments.joins(:user).merge(User.not_archived).count,
          active_count: cohort.enrollments.active.joins(:user).merge(User.not_archived).count,
          announcements: Array((cohort.settings || {})["announcements"]),
          recordings: Array((cohort.settings || {})["recordings"]),
          class_resources: Array((cohort.settings || {})["class_resources"]),
          office_hours: office_hours_payload[:office_hours],
          office_hour_occurrences: office_hours_payload[:upcoming]
        }

        json[:uploaded_recordings_count] = cohort.recordings.count if include_students

        if include_students
          json[:students] = cohort.enrollments.joins(:user).includes(:user, module_assignments: :curriculum_module).merge(User.not_archived).map { |e|
            {
              enrollment_id: e.id,
              user_id: e.user.id,
              full_name: e.user.full_name,
              email: e.user.email,
              github_username: e.user.github_username,
              status: e.status,
              enrolled_at: e.enrolled_at,
              last_sign_in_at: e.user.last_sign_in_at,
              last_seen_at: e.user.last_seen_at,
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
          active_enrollments = cohort.enrollments.active.includes(module_assignments: :curriculum_module)
          assignment_index = active_enrollments.each_with_object(Hash.new { |h, k| h[k] = [] }) do |enrollment, hash|
            enrollment.module_assignments.each { |assignment| hash[assignment.module_id] << assignment }
          end
          schedule_index = cohort.cohort_module_schedules.index_by(&:module_id)

          github_config = (cohort.settings || {}).dig("module_github_config") || {}

          json[:modules] = cohort.curriculum.modules.map do |mod|
            assignments = assignment_index[mod.id]
            mod_gh = github_config[mod.id.to_s] || {}
            module_start_date = schedule_index[mod.id]&.start_date || mod.legacy_start_date_for(cohort)
            {
              id: mod.id,
              name: mod.name,
              module_type: mod.module_type,
              position: mod.position,
              lessons_count: mod.lessons.size,
              assigned_count: assignments.size,
              assigned: assignments.size.positive?,
              unlocked_count: assignments.count(&:unlocked?),
              accessible_count: assignments.count { |assignment| assignment.accessible?(cohort) },
              module_start_date: module_start_date,
              uses_default_start_date: schedule_index[mod.id].nil?,
              requires_github: mod_gh["requires_github"] || false,
              repository_name: mod_gh["repository_name"].presence || cohort.repository_name,
              week_count: mod.week_count,
              submission_windows: module_submission_windows_json(cohort, mod, module_start_date)
            }
          end
        end

        json
      end
    end
  end
end
