module Api
  module V1
    class SubmissionsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_submission, only: [:show, :update, :grade]

      # GET /api/v1/submissions
      def index
        submissions = Submission.includes(:user, :content_block, :grader)

        # Filter by student
        if params[:user_id].present?
          submissions = submissions.where(user_id: params[:user_id])
        elsif !current_user.staff?
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
        submission = current_user.submissions.new(submission_params)

        # Check if resubmission
        existing = Submission.where(user: current_user, content_block_id: submission.content_block_id).order(:created_at).last
        if existing
          submission.num_submissions = existing.num_submissions + 1
        end

        if submission.save
          # Auto-mark content block as in_progress
          Progress.find_or_create_by(user: current_user, content_block_id: submission.content_block_id) do |p|
            p.status = :in_progress
          end

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

        # If graded (not R), mark the content block as completed
        if @submission.grade != "R"
          progress = Progress.find_or_initialize_by(
            user_id: @submission.user_id,
            content_block_id: @submission.content_block_id
          )
          progress.update(status: :completed)
        end

        render json: { submission: submission_json(@submission) }
      end

      private

      def set_submission
        @submission = Submission.find(params[:id])
      end

      def submission_params
        params.permit(:content_block_id, :text, :github_issue_url, :github_code_url)
      end

      def submission_update_params
        params.permit(:text, :github_issue_url, :github_code_url)
      end

      def submission_json(submission, include_solution: false)
        json = {
          id: submission.id,
          content_block_id: submission.content_block_id,
          user_id: submission.user_id,
          user_name: submission.user.full_name,
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
          lesson_title: submission.content_block.lesson.title
        }

        if include_solution
          json[:solution] = submission.content_block.solution
        end

        json
      end
    end
  end
end
