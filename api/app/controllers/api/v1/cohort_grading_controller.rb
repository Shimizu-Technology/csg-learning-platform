module Api
  module V1
    class CohortGradingController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_cohort
      before_action :set_module

      # GET /api/v1/cohorts/:cohort_id/modules/:module_id/submissions
      def index
        student_ids = @cohort.enrollments.active.pluck(:user_id)
        block_ids = ContentBlock.joins(:lesson)
          .where(lessons: { module_id: @curriculum_module.id })
          .where(block_type: [ :exercise, :code_challenge ])
          .pluck(:id)

        submissions = Submission.includes(:user, :content_block, :grader)
          .where(user_id: student_ids, content_block_id: block_ids)
          .order(created_at: :desc)

        students_data = @cohort.enrollments.active.includes(:user).map do |enrollment|
          user = enrollment.user
          user_submissions = submissions.select { |s| s.user_id == user.id }
          {
            user_id: user.id,
            full_name: user.full_name,
            email: user.email,
            github_username: user.github_username,
            total_exercises: block_ids.size,
            submitted: user_submissions.map(&:content_block_id).uniq.size,
            ungraded: user_submissions.count { |s| s.grade.nil? },
            graded: user_submissions.count { |s| s.grade.present? && s.grade != "R" },
            redo: user_submissions.count { |s| s.grade == "R" }
          }
        end

        mod_gh = module_github_config

        exercises = ContentBlock.joins(:lesson)
          .where(id: block_ids)
          .where.not(filename: [ nil, "" ])
          .includes(:lesson)
          .order("lessons.release_day ASC, lessons.position ASC, content_blocks.position ASC")
          .map do |cb|
            {
              id: cb.id,
              filename: cb.filename,
              title: cb.title,
              release_day: cb.lesson.release_day,
              lesson_title: cb.lesson.title
            }
          end

        render json: {
          cohort_id: @cohort.id,
          cohort_name: @cohort.name,
          module_id: @curriculum_module.id,
          module_name: @curriculum_module.name,
          requires_github: mod_gh["requires_github"] || false,
          repository_name: mod_gh["repository_name"].presence || @cohort.repository_name,
          students: students_data,
          exercises: exercises,
          submissions: submissions.map { |s| submission_json(s) }
        }
      end

      # POST /api/v1/cohorts/:cohort_id/modules/:module_id/sync_github
      def sync_all
        github_token = resolve_github_token
        unless github_token
          render json: { error: "No GitHub token configured. Set GITHUB_ORGANIZATION_ADMIN_TOKEN in environment." }, status: :unprocessable_entity
          return
        end

        repo_name = effective_repository_name
        service = GithubSyncService.new(github_token: github_token)
        results = service.sync_cohort_module(cohort: @cohort, curriculum_module: @curriculum_module, repository_name_override: repo_name)

        total_synced = results.values.sum { |r| r[:synced] }
        all_errors = results.flat_map { |uid, r| r[:errors].map { |e| "User #{uid}: #{e}" } }

        render json: {
          synced: total_synced,
          students_processed: results.size,
          errors: all_errors
        }
      end

      # POST /api/v1/cohorts/:cohort_id/modules/:module_id/sync_github/:user_id
      def sync_student
        user = User.find(params[:user_id])
        enrollment = @cohort.enrollments.active.find_by(user: user)
        unless enrollment
          render json: { error: "Student is not actively enrolled in this cohort" }, status: :not_found
          return
        end

        github_token = resolve_github_token
        unless github_token
          render json: { error: "No GitHub token configured. Set GITHUB_ORGANIZATION_ADMIN_TOKEN in environment." }, status: :unprocessable_entity
          return
        end

        repo_name = effective_repository_name
        service = GithubSyncService.new(github_token: github_token)
        result = service.sync_student(user: user, cohort: @cohort, curriculum_module: @curriculum_module, repository_name_override: repo_name)

        render json: {
          user_id: user.id,
          synced: result[:synced],
          errors: result[:errors]
        }
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def set_module
        @curriculum_module = @cohort.curriculum.modules.find(params[:module_id])
      end

      def resolve_github_token
        ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"].presence
      end

      def module_github_config
        (@cohort.settings || {}).dig("module_github_config", @curriculum_module.id.to_s) || {}
      end

      def effective_repository_name
        mod_gh = module_github_config
        mod_gh["repository_name"].presence || @cohort.repository_name
      end

      def submission_json(submission)
        {
          id: submission.id,
          content_block_id: submission.content_block_id,
          user_id: submission.user_id,
          user_name: submission.user.full_name,
          user_email: submission.user.email,
          text: submission.text,
          grade: submission.grade,
          feedback: submission.feedback,
          graded_by: submission.grader&.full_name,
          graded_at: submission.graded_at,
          github_issue_url: submission.github_issue_url,
          github_code_url: submission.github_code_url,
          num_submissions: submission.num_submissions,
          created_at: submission.created_at,
          content_block_title: submission.content_block.title,
          content_block_type: submission.content_block.block_type,
          lesson_title: submission.content_block.lesson.title,
          filename: submission.content_block.filename,
          language_hint: submission.content_block.metadata.is_a?(Hash) ? submission.content_block.metadata["language"] : nil
        }
      end
    end
  end
end
