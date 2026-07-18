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
        exercise_blocks = ContentBlock.joins(:lesson)
          .where(lessons: { module_id: @curriculum_module.id })
          .where(block_type: [ :exercise, :code_challenge ])
          .includes(lesson: :curriculum_module)
          .order("lessons.release_day ASC, lessons.position ASC, content_blocks.position ASC")
          .to_a
        block_ids = exercise_blocks.map(&:id)

        submissions = Submission.includes(:user, { content_block: { lesson: :curriculum_module } }, :grader)
          .where(user_id: student_ids, content_block_id: block_ids)
          .order(created_at: :desc)
        progress_records = Progress.where(user_id: student_ids, content_block_id: block_ids)

        students_data = @cohort.enrollments.active.joins(:user).includes(:user).merge(User.not_archived).map do |enrollment|
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
        requires_github = mod_gh["requires_github"] || false

        exercises = exercise_blocks.map do |cb|
          submission_type = cb.effective_submission_type(requires_github: requires_github)
          submission_window = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: cb.lesson)

          {
            id: cb.id,
            filename: cb.filename,
            title: cb.title,
            release_day: cb.lesson.release_day,
            lesson_title: cb.lesson.title,
            requires_submission: cb.review_required?(requires_github: requires_github),
            submission_type: submission_type,
            submission_config: cb.submission_config || {},
            github_sync: submission_type == "prework_github_sync",
            submission_window: submission_window
          }
        end

        render json: {
          cohort_id: @cohort.id,
          cohort_name: @cohort.name,
          module_id: @curriculum_module.id,
          module_name: @curriculum_module.name,
          requires_github: requires_github,
          supports_github_sync: exercises.any? { |exercise| exercise[:github_sync] },
          open_github_sync_count: exercises.count do |exercise|
            exercise[:github_sync] && !exercise[:submission_window][:submissions_closed]
          end,
          repository_name: mod_gh["repository_name"].presence || @cohort.repository_name,
          students: students_data,
          exercises: exercises,
          progresses: progress_records.map { |progress|
            {
              user_id: progress.user_id,
              content_block_id: progress.content_block_id,
              status: progress.status,
              completed_at: progress.completed_at
            }
          },
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
        @cohort = Cohort.includes(:cohort_module_submission_windows).find(params[:cohort_id])
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
        submission_type = submission.submission_type.presence || submission.content_block.effective_submission_type
        {
          id: submission.id,
          content_block_id: submission.content_block_id,
          user_id: submission.user_id,
          user_name: submission.user.full_name,
          user_email: submission.user.email,
          submission_type: submission_type,
          text: submission.text,
          grade: submission.grade,
          feedback: submission.feedback,
          graded_by: submission.grader&.full_name,
          graded_at: submission.graded_at,
          github_issue_url: submission.github_issue_url,
          github_code_url: submission.github_code_url,
          repo_url: submission.repo_url,
          pr_url: submission.pr_url,
          live_url: submission.live_url,
          branch: submission.branch,
          commit_sha: submission.commit_sha,
          notes: submission.notes,
          num_submissions: submission.num_submissions,
          created_at: submission.created_at,
          content_block_title: submission.content_block.title,
          content_block_type: submission.content_block.block_type,
          lesson_title: submission.content_block.lesson.title,
          filename: submission.content_block.filename,
          submission_config: submission.content_block.submission_config || {},
          language_hint: submission.content_block.metadata.is_a?(Hash) ? submission.content_block.metadata["language"] : nil
        }
      end
    end
  end
end
