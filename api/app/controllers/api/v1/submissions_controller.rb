module Api
  module V1
    class SubmissionsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_submission, only: [ :show, :update, :grade, :github_issue ]
      before_action :authorize_submission_read!, only: [ :show ]

      # GET /api/v1/submissions
      def index
        submissions = Submission.includes(:user, { content_block: { lesson: :curriculum_module } }, :grader)

        # Staff can filter by any student; students can only see themselves.
        if current_user.staff?
          submissions = submissions.where(user_id: params[:user_id]) if params[:user_id].present?
        else
          submissions = submissions.where(user_id: current_user.id)
        end

        # Filter by module
        if params[:module_id].present?
          block_ids = ContentBlock.joins(:lesson).where(lessons: { module_id: params[:module_id] }).pluck(:id)
          submissions = submissions.where(content_block_id: block_ids)
        end

        # Filter by ungraded
        if params[:ungraded] == "true"
          submissions = submissions.where(grade: nil)
        end

        submissions = submissions.order(created_at: :desc)

        render json: {
          submissions: submissions.map { |s| submission_json(s) }
        }
      end

      # GET /api/v1/submissions/:id
      def show
        render json: { submission: submission_json(@submission, include_solution: current_user.staff?) }
      end

      # POST /api/v1/submissions
      def create
        content_block = ContentBlock.find(params[:content_block_id])
        authorize_content_block_write!(content_block)
        return if performed?
        authorize_submission_window_open!(content_block)
        return if performed?

        submission_type = effective_submission_type_for(content_block)

        if submission_type == "manual_complete"
          render json: { errors: [ "This block does not accept submissions" ] }, status: :unprocessable_entity
          return
        end

        if submission_type == "prework_github_sync"
          render json: { errors: [ "This block is reviewed through GitHub sync, not manual submission" ] }, status: :unprocessable_entity
          return
        end

        validation_error = validate_submission_payload(submission_type)
        if validation_error
          render json: { errors: [ validation_error ] }, status: :unprocessable_entity
          return
        end

        submission = current_user.submissions.new(submission_params)
        submission.submission_type = submission_type

        # Check if resubmission
        existing = Submission.where(user: current_user, content_block_id: submission.content_block_id).order(:created_at).last
        if existing
          submission.num_submissions = existing.num_submissions + 1
        end

        if submission.save
          progress = Progress.find_or_initialize_by(user: current_user, content_block_id: submission.content_block_id)
          progress.update!(status: :completed)
          SubmissionNotificationJob.perform_later("created", submission.id)

          render json: { submission: submission_json(submission) }, status: :created
        else
          render json: { errors: submission.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/submissions/:id
      def update
        # Students can only update their own ungraded submissions
        unless current_user.staff? || (@submission.user_id == current_user.id && @submission.grade.nil?)
          render_forbidden("Cannot update this submission")
          return
        end

        unless current_user.staff?
          authorize_content_block_write!(@submission.content_block)
          return if performed?
          authorize_submission_window_open!(@submission.content_block)
          return if performed?
        end

        if @submission.update(submission_update_params)
          render json: { submission: submission_json(@submission) }
        else
          render json: { errors: @submission.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/submissions/:id/grade
      def grade
        require_staff!
        return if performed?

        @submission.update!(
          grade: params[:grade],
          feedback: params[:feedback],
          graded_by_id: current_user.id,
          graded_at: Time.current
        )

        if @submission.grade != "R"
          progress = Progress.find_or_initialize_by(
            user_id: @submission.user_id,
            content_block_id: @submission.content_block_id
          )
          progress.update!(status: :completed)
        else
          progress = Progress.find_or_initialize_by(
            user_id: @submission.user_id,
            content_block_id: @submission.content_block_id
          )
          progress.update!(status: :in_progress)

          NotificationEmailService.send_redo_notification(
            user: @submission.user,
            submission: @submission,
            feedback: @submission.feedback
          )
        end

        SubmissionNotificationJob.perform_later("graded", @submission.id)

        token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
        if token.present?
          GithubIssueService.handle_grade(
            submission: @submission,
            grade: @submission.grade,
            feedback: @submission.feedback,
            token: token
          )
          @submission.reload
        end

        render json: { submission: submission_json(@submission) }
      end

      # GET /api/v1/submissions/:id/github_issue
      def github_issue
        require_staff!
        return if performed?

        unless @submission.github_issue_url.present?
          render json: { error: "No GitHub issue linked to this submission" }, status: :not_found
          return
        end

        token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
        unless token.present?
          render json: { error: "GitHub token not configured" }, status: :service_unavailable
          return
        end

        issue_data = GithubIssueService.fetch_issue_with_comments(
          issue_url: @submission.github_issue_url,
          token: token
        )

        if issue_data[:error]
          render json: { error: issue_data[:error] }, status: :unprocessable_entity
        else
          render json: issue_data
        end
      end

      private

      def set_submission
        @submission = Submission.find(params[:id])
      end

      def authorize_submission_read!
        return if current_user.staff? || @submission.user_id == current_user.id

        render_forbidden("Cannot view this submission")
      end

      def submission_params
        params.permit(:content_block_id, :text, :github_issue_url, :github_code_url, :repo_url, :pr_url,
                      :live_url, :branch, :commit_sha, :notes)
      end

      def submission_update_params
        params.permit(:text, :github_issue_url, :github_code_url, :repo_url, :pr_url, :live_url, :branch,
                      :commit_sha, :notes)
      end

      def submission_json(submission, include_solution: false)
        submission_type = submission.submission_type.presence || submission.content_block.effective_submission_type
        json = {
          id: submission.id,
          content_block_id: submission.content_block_id,
          user_id: submission.user_id,
          user_name: submission.user.full_name,
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

        if include_solution
          json[:solution] = submission.content_block.solution
          json[:exercise_body] = submission.content_block.body
          json[:exercise_video_url] = submission.content_block.video_url
        end

        json
      end

      def effective_submission_type_for(content_block)
        lesson = content_block.lesson
        enrollment = current_user.enrollments.active
          .joins(:cohort)
          .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
        mod_gh = enrollment ? ((enrollment.cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s) || {}) : {}

        content_block.effective_submission_type(requires_github: mod_gh["requires_github"] || false)
      end

      def validate_submission_payload(submission_type)
        case submission_type
        when "text_submission"
          "Submission text is required" if params[:text].to_s.strip.blank?
        when "repo_url_submission"
          "Repository URL is required" if params[:repo_url].to_s.strip.blank?
        when "repo_and_live_url_submission"
          if params[:repo_url].to_s.strip.blank?
            "Repository URL is required"
          elsif params[:live_url].to_s.strip.blank?
            "Live URL is required"
          end
        end
      end
    end
  end
end
