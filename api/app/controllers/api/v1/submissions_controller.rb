module Api
  module V1
    class SubmissionsController < ApplicationController
      class StaleGradingWrite < StandardError; end
      class SupersededAttempt < StandardError; end
      REDO_FEEDBACK_REQUIRED = "Write feedback before choosing Redo, so the student knows what to change.".freeze
      GRADE_INVALID = "Grade must be A, B, C or R.".freeze

      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_student!, only: [ :create ]
      before_action :set_submission, only: [ :show, :update, :grade, :github_issue, :retry_github_issue ]
      before_action :authorize_submission_read!, only: [ :show ]

      # GET /api/v1/submissions
      def index
        includes = [ { user: { enrollments: :cohort } }, { enrollment: :cohort }, :grader,
          :submission_criterion_results, { content_block: { lesson: :curriculum_module, rubric: { rubric_criteria: :learning_objective } } } ]
        includes << :github_issue_deliveries if current_user.staff?
        submissions = Submission.includes(*includes)

        # Staff can filter by any student; students can only see themselves.
        if current_user.staff?
          submissions = submissions.where(enrollment_id: Enrollment.where(cohort_id: current_user.accessible_cohorts.select(:id)).select(:id))
          submissions = submissions.where(user_id: params[:user_id]) if params[:user_id].present?
        else
          submissions = submissions.where(user_id: current_user.id)
        end
        if params[:cohort_id].present?
          cohort = Cohort.find(params[:cohort_id])
          return unless require_cohort_access!(cohort, teacher: current_user.staff?)
          submissions = submissions.joins(:enrollment).where(enrollments: { cohort_id: cohort.id })
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

        submissions = submissions.order(created_at: :desc).to_a
        latest_attempt_ids = Submission.latest_attempt_ids_for(submissions)

        render json: {
          submissions: submissions.map { |s| submission_json(s, latest_attempt_ids: latest_attempt_ids) }
        }
      end

      # GET /api/v1/submissions/:id
      def show
        render json: { submission: submission_json(@submission, include_solution: current_user.staff?, include_github_checks: true) }
      end

      # POST /api/v1/submissions
      def create
        content_block = ContentBlock.find(moved_content_id("ContentBlock", params[:content_block_id]))
        authorize_content_block_write!(content_block)
        return if performed?
        authorize_submission_window_open!(content_block)
        return if performed?

        submission_type = content_block.submission_type_for(@learning_write_enrollment)

        if submission_type == "manual_complete"
          render json: { errors: [ "This block does not accept submissions" ] }, status: :unprocessable_entity
          return
        end

        if submission_type == "prework_github_sync"
          render json: { errors: [ "This block is reviewed through GitHub sync, not manual submission" ] }, status: :unprocessable_entity
          return
        end

        submission = current_user.submissions.new(submission_params)
        # The block the request resolved to (an old id may name a cohort's copy).
        submission.content_block = content_block
        submission.enrollment = @learning_write_enrollment
        submission.submission_type = submission_type

        return unless validate_submission_content!(submission)

        with_learning_write_guard(@learning_write_enrollment) do
          return unless recheck_content_block_write!(content_block, @learning_write_enrollment)
          authorize_submission_window_open!(content_block, enrollment: @learning_write_enrollment, fresh: true)
          return if performed?

          existing = submission.latest_attempt
          submission.num_submissions = existing.num_submissions + 1 if existing
          if submission.save
            if GithubIssueDeliveryPlanner.enabled_for?(submission.enrollment&.cohort)
              GithubIssueDeliveryPlanner.obsolete_pending!(
                enrollment_id: submission.enrollment_id,
                content_block_id: submission.content_block_id
              )
            end
            progress = Progress.find_or_initialize_by(enrollment: submission.enrollment, content_block_id: submission.content_block_id)
            progress.user = current_user
            progress.update!(status: :completed)
            ActivityEvent.record!(event_type: "submission_created", actor: current_user,
              cohort: @learning_write_enrollment&.cohort, record: submission)
            SubmissionNotificationJob.perform_later("created", submission.id, submission.created_at.iso8601(6))

            render json: { submission: submission_json(submission, include_github_checks: true) }, status: :created
          else
            render json: { errors: submission.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      # PATCH /api/v1/submissions/:id
      def update
        if current_user.staff?
          return unless authorize_submission_cohort!
        end
        # Students can only update their own ungraded submissions
        unless current_user.staff? || (@submission.user_id == current_user.id && @submission.grade.nil?)
          render_forbidden("Cannot update this submission")
          return
        end

        unless current_user.staff?
          authorize_content_block_write!(@submission.content_block)
          return if performed?
          unless @submission.enrollment_id == @learning_write_enrollment&.id
            render_forbidden("Cannot update a submission from another cohort")
            return
          end
          authorize_submission_window_open!(@submission.content_block)
          return if performed?
        end

        with_learning_write_guard(@submission.enrollment) do
          return unless recheck_content_block_write!(@submission.content_block, @learning_write_enrollment)
          authorize_submission_window_open!(@submission.content_block, enrollment: @learning_write_enrollment, fresh: true)
          return if performed?

          @submission.lock!
          unless current_user.staff? || @submission.grade.nil?
            render_forbidden("Cannot update a graded submission")
            return
          end
          raise SupersededAttempt unless @submission.latest_attempt&.id == @submission.id
          @submission.assign_attributes(submission_update_params)
          return unless validate_submission_content!(@submission)
          if @submission.save
            if @submission.saved_changes.except("updated_at").any?
              ActivityEvent.record!(event_type: "submission_updated", actor: current_user,
                subject_user: @submission.user,
                cohort: learning_enrollment_for(@submission.user, @submission.content_block)&.cohort,
                record: @submission)
            end
            render json: { submission: submission_json(@submission, include_github_checks: true) }
          else
            render json: { errors: @submission.errors.full_messages }, status: :unprocessable_entity
          end
        end
      rescue SupersededAttempt
        render_superseded_attempt
      end

      # PATCH /api/v1/submissions/:id/grade
      def grade
        require_staff!
        return if performed?
        return unless authorize_submission_cohort!
        base_updated_at = requested_grading_base_updated_at
        return if performed?

        rubric = @submission.content_block.rubric
        requested_results = criterion_results_params
        expected_criterion_ids = rubric&.rubric_criteria&.pluck(:id) || []
        # A redo asks for written feedback, not a full rubric: it may carry any subset of the
        # criteria (or none, which leaves existing evidence alone). A/B/C need every criterion.
        # The grade is one of the letters, as a string. Enum integers ("3", 3) and anything
        # else are refused, so no form of Redo can skip the rule below. Nothing is written yet.
        grade = params[:grade]
        unless grade.is_a?(String) && Submission.grades.key?(grade)
          render json: { errors: [ GRADE_INVALID ] }, status: :unprocessable_entity
          return
        end
        redo_grade = grade == "R"
        # A redo tells the student what to change, so it needs written feedback (rubric
        # ratings stay optional). Unicode spaces and zero-width characters don't count.
        if redo_grade && Submission.blank_feedback?(params[:feedback])
          render json: { errors: [ REDO_FEEDBACK_REQUIRED ] }, status: :unprocessable_entity
          return
        end
        criterion_results_provided = params.key?(:criterion_results) && !(redo_grade && requested_results.empty?)
        if criterion_results_provided && !rubric_results_acceptable?(requested_results, expected_criterion_ids, partial: redo_grade)
          render json: { errors: [ rubric ? "Rate every rubric criterion before grading" : "This submission does not use a rubric" ] }, status: :unprocessable_entity
          return
        end

        enrollment = @submission.enrollment
        use_v2_issue_delivery = GithubIssueDeliveryPlanner.enabled_for?(enrollment&.cohort)
        with_learning_write_guard(enrollment) do
          Submission.transaction do
            @submission.lock!
            raise SupersededAttempt unless @submission.latest_attempt&.id == @submission.id
            if @submission.updated_at != base_updated_at
              raise StaleGradingWrite
            end

            @submission.update!(
              grade: grade,
              feedback: params[:feedback],
              graded_by_id: current_user.id,
              graded_at: Time.current
            )

            if criterion_results_provided
              @submission.submission_criterion_results.destroy_all
              requested_results.each do |result|
                @submission.submission_criterion_results.create!(result)
              end
            end

            progress = Progress.find_or_initialize_by(
              enrollment: enrollment,
              user_id: @submission.user_id,
              content_block_id: @submission.content_block_id
            )
            progress.update!(status: @submission.grade == "R" ? :in_progress : :completed)
            ActivityEvent.record!(event_type: "submission_graded", actor: current_user,
              subject_user: @submission.user, cohort: enrollment&.cohort, record: @submission)

            if use_v2_issue_delivery
              GithubIssueDeliveryPlanner.record!(
                submission: @submission,
                grade: @submission.grade,
                feedback: @submission.feedback
              )
            end
          end
        end

        if @submission.grade == "R"
          NotificationEmailService.send_redo_notification(
            user: @submission.user,
            submission: @submission,
            feedback: @submission.feedback
          )
        end

        SubmissionNotificationJob.perform_later("graded", @submission.id, @submission.graded_at.iso8601(6))

        if use_v2_issue_delivery
          @submission.association(:github_issue_deliveries).reset
        else
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
        end

        render json: { submission: submission_json(@submission, include_github_checks: true) }
      rescue SupersededAttempt
        render_superseded_attempt
      rescue StaleGradingWrite
        @submission.reload
        render json: {
          error: "This submission changed after you opened it. Your draft was kept; review the latest version before saving again.",
          code: "stale_submission"
        }, status: :conflict
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      # GET /api/v1/submissions/:id/github_issue
      def github_issue
        require_staff!
        return if performed?
        return unless authorize_submission_cohort!

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

      # POST /api/v1/submissions/:id/retry_github_issue
      def retry_github_issue
        require_staff!
        return if performed?
        return unless authorize_submission_cohort!

        delivery = latest_github_issue_delivery(@submission)
        unless delivery
          render json: { error: "No GitHub issue delivery found for this submission" }, status: :not_found
          return
        end

        if delivery.delivered?
          render json: { error: "GitHub feedback was already delivered for this submission" }, status: :unprocessable_entity
          return
        end

        if delivery.obsolete?
          render json: { error: "This GitHub feedback delivery was superseded by a newer update" }, status: :unprocessable_entity
          return
        end

        GithubIssueDeliveryDrain.new.deliver_one!(delivery, force: true)
        @submission.reload
        @submission.association(:github_issue_deliveries).reset
        delivery.reload

        render json: {
          submission: submission_json(@submission, include_solution: true, include_github_checks: true),
          github_issue_delivery: delivery.to_staff_json
        }
      end

      private

      def learning_enrollment_for(user, content_block)
        curriculum_id = content_block.lesson.curriculum_module.curriculum_id
        candidates = if user.enrollments.loaded?
          user.enrollments.select { |enrollment| enrollment.cohort.curriculum_id == curriculum_id }
        else
          user.enrollments.includes(:cohort).joins(:cohort).where(cohorts: { curriculum_id: curriculum_id }).to_a
        end

        candidates.min_by do |enrollment|
          [ Enrollment.statuses.fetch(enrollment.status), -(enrollment.enrolled_at || Time.at(0)).to_f, -enrollment.id ]
        end
      end

      def authorize_submission_cohort!
        enrollment = @submission.enrollment
        unless enrollment && current_user.can_teach_cohort?(enrollment.cohort)
          render_forbidden("Cannot access this submission")
          return false
        end
        true
      end

      def set_submission
        includes = [ { user: { enrollments: :cohort } }, { content_block: { lesson: :curriculum_module } } ]
        includes << :github_issue_deliveries if current_user.staff?
        @submission = Submission.includes(*includes).find(params[:id])
      end

      def authorize_submission_read!
        return if @submission.user_id == current_user.id
        return if current_user.staff? && @submission.enrollment && current_user.can_teach_cohort?(@submission.enrollment.cohort)

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

      def requested_grading_base_updated_at
        value = params[:base_submission_updated_at]
        if value.blank?
          render json: { errors: [ "base_submission_updated_at is required" ] }, status: :unprocessable_entity
          return nil
        end

        Time.iso8601(value.to_s)
      rescue ArgumentError
        render json: { errors: [ "base_submission_updated_at must be an ISO 8601 timestamp" ] }, status: :unprocessable_entity
        nil
      end

      def submission_json(submission, include_solution: false, include_github_checks: false, latest_attempt_ids: nil)
        submission_type = submission.effective_submission_type
        enrollment = submission.enrollment || learning_enrollment_for(submission.user, submission.content_block)
        json = {
          id: submission.id,
          enrollment_id: submission.enrollment_id,
          latest_submission_id: latest_attempt_ids ? latest_attempt_ids[submission.attempt_key] : submission.latest_attempt&.id,
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
          updated_at: submission.updated_at.iso8601(6),
          content_block_title: submission.content_block.display_title(fallback: "Exercise"),
          content_block_type: submission.content_block.block_type,
          lesson_id: submission.content_block.lesson_id,
          lesson_title: submission.content_block.lesson.title,
          module_id: submission.content_block.lesson.module_id,
          module_name: submission.content_block.lesson.curriculum_module.name,
          module_position: submission.content_block.lesson.curriculum_module.position,
          cohort_id: enrollment&.cohort_id,
          cohort_name: enrollment&.cohort&.name,
          # The grading queue's context line: "Cohort 3 · Week 10", or "self-paced" with no week.
          course_delivery: enrollment&.cohort&.course_delivery,
          week_number: enrollment&.cohort&.self_paced? ? nil : SubmissionWindowStatus.week_number_for_release_day(submission.content_block.lesson.release_day),

          filename: submission.content_block.filename,
          submission_config: submission.content_block.submission_config || {},
          language_hint: submission.content_block.metadata.is_a?(Hash) ? submission.content_block.metadata["language"] : nil
        }

        json[:rubric] = rubric_json(submission)
        json[:github_checks] = GithubCheckRunSerializer.collection_json(submission) if include_github_checks

        if current_user.staff?
          delivery = latest_github_issue_delivery(submission)
          json[:github_issue_delivery] = delivery.to_staff_json if delivery
        end

        if include_solution
          json[:solution] = submission.content_block.solution
          json[:exercise_body] = submission.content_block.body
          json[:exercise_video_url] = submission.content_block.video_url
        end

        json
      end

      def latest_github_issue_delivery(submission)
        if submission.association(:github_issue_deliveries).loaded?
          submission.github_issue_deliveries.max_by(&:id)
        else
          submission.github_issue_deliveries.order(id: :desc).first
        end
      end

      def rubric_results_acceptable?(requested_results, expected_criterion_ids, partial:)
        requested_ids = requested_results.map { |result| result[:rubric_criterion_id].to_i }
        return requested_ids.sort == expected_criterion_ids.sort unless partial

        requested_ids.uniq.size == requested_ids.size && (requested_ids - expected_criterion_ids).empty?
      end

      def criterion_results_params
        raw = params[:criterion_results]
        return [] if raw.blank?

        params.require(:criterion_results).map do |result|
          result.permit(:rubric_criterion_id, :rating, :feedback).to_h.symbolize_keys
        end
      end

      def rubric_json(submission)
        rubric = submission.content_block.rubric
        return nil unless rubric

        results = submission.submission_criterion_results.index_by(&:rubric_criterion_id)
        {
          id: rubric.id,
          title: rubric.title,
          description: rubric.description,
          criteria: rubric.rubric_criteria.map do |criterion|
            result = results[criterion.id]
            {
              id: criterion.id,
              title: criterion.title,
              description: criterion.description,
              objective_code: criterion.learning_objective&.code,
              rating: result&.rating,
              feedback: result&.feedback
            }
          end
        }
      end

      def validate_submission_content!(submission)
        return true if submission.validate_required_content

        render json: { errors: submission.errors.messages.values.flatten, field_errors: submission.errors.to_hash }, status: :unprocessable_entity
        false
      end

      def render_superseded_attempt
        render json: {
          error: "This is a previous attempt. Grade the latest attempt; your draft was kept.",
          code: "superseded_submission",
          enrollment_id: @submission.enrollment_id,
          latest_submission_id: @submission.latest_attempt&.id
        }, status: :conflict
      end
    end
  end
end
