module Api
  module V1
    class EnrollmentsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!
      before_action :set_cohort, only: [ :index, :create, :bulk ]
      before_action :set_enrollment, only: [ :show, :update, :destroy ]

      # GET /api/v1/cohorts/:cohort_id/enrollments
      def index
        enrollments = @cohort.enrollments.joins(:user).includes(:user).merge(User.not_archived)
        render json: {
          enrollments: enrollments.map { |e| enrollment_json(e) }
        }
      end

      # GET /api/v1/enrollments/:id
      def show
        render json: { enrollment: enrollment_json(@enrollment, include_progress: true) }
      end

      # POST /api/v1/cohorts/:cohort_id/enrollments
      def create
        user = User.find(params[:user_id])
        enrollment = nil

        user.with_lock do
          @cohort.with_lock do
            enrollment = @cohort.enrollments.new(user: user)
            enrollment.assign_cohort_content_defaults! if enrollment.save && !@cohort.alumni?
          end
        end

        if enrollment.persisted?
          invitation = dispatch_invitation(user)
          unless user.invite_pending?
            Notification.create!(
              user: user,
              actor: current_user,
              notifiable: enrollment,
              notification_type: :system,
              title: "You've been added to #{@cohort.name}",
              body: "Open your cohort workspace to see your class, schedule, and messages.",
              path: "/cohorts/#{@cohort.id}"
            )
          end
          render json: {
            enrollment: enrollment_json(enrollment),
            invitation: invitation && {
              status: invitation.status,
              error: invitation.error
            }
          }.compact, status: :created
        else
          render json: { errors: enrollment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # Provider dispatch happens after the enrollment transaction commits.
      def bulk
        rows = params[:rows]
        unless rows.is_a?(Array) && rows.size.between?(1, 200)
          return render json: { errors: [ "Provide between 1 and 200 rows" ] }, status: :unprocessable_entity
        end
        dispatch_only = ActiveModel::Type::Boolean.new.cast(params[:dispatch_only])
        inviting = ActiveModel::Type::Boolean.new.cast(params[:send_invite])
        limit = inviting || dispatch_only ? 3 : 25
        return render json: { errors: [ "This mode accepts at most #{limit} rows" ] }, status: :unprocessable_entity if rows.size > limit

        key = "bulk-enrollment-rows:#{current_user.id}:#{Time.current.to_i / 10.minutes.to_i}"
        count = ApiRateLimits::STORE.read(key).to_i
        return render_rate_limit(10.minutes) if count + rows.size > 1000
        ApiRateLimits::STORE.increment(key, rows.size, expires_in: 10.minutes, initial: 0)
        users = User.where("LOWER(email) IN (?)", rows.filter_map { |row| row[:email].to_s.strip.downcase if row.is_a?(ActionController::Parameters) }).index_by { |user| user.email.downcase }
        enrollments = @cohort.enrollments.index_by(&:user_id)
        @bulk_modules = @cohort.curriculum.modules.to_a
        @cohort.initialize_content_defaults! unless dispatch_only

        seen = Set.new
        results = rows.map.with_index do |row, index|
          email = row.is_a?(ActionController::Parameters) ? row[:email].to_s.strip.downcase : ""
          result = { row: index + 1, email: email }
          if !email.match?(URI::MailTo::EMAIL_REGEXP)
            result.merge(status: "error", error: "Invalid email")
          elsif !seen.add?(email)
            result.merge(status: "duplicate")
          else
            begin
              attempts = 0
              begin
                created = false
                user = nil
                enrollment = nil
                User.transaction(requires_new: true) do
                  user = users[email]
                  raise ArgumentError, "This email belongs to a staff or archived account" if user && (!user.student? || user.archived?)
                  raise ArgumentError, "Enroll this learner before sending an invitation" if dispatch_only && (!user || !enrollments[user.id])
                  user ||= User.create!(email: email, clerk_id: "pending_#{SecureRandom.uuid}", role: :student,
                    first_name: row[:first_name].to_s.strip, last_name: row[:last_name].to_s.strip)
                  users[email] = user
                  user.with_lock do
                    @cohort.with_lock do
                      enrollment = enrollments[user.id]
                      unless enrollment
                        enrollment = @cohort.enrollments.create!(user: user)
                        assign_bulk_content_defaults(enrollment) unless @cohort.alumni?
                        enrollments[user.id] = enrollment
                        created = true
                      end
                    end
                  end
                end
              rescue ActiveRecord::RecordNotUnique
                users[email] = User.where("LOWER(email) = ?", email).first
                enrollments = @cohort.enrollments.index_by(&:user_id)
                attempts += 1
                retry if attempts < 3
                raise
              end
              if enrollment.dropped?
                result.merge(status: "previously_dropped")
              else
                invitation = dispatch_invitation(user)
                if created && !user.invite_pending?
                  Notification.create!(user: user, actor: current_user, notifiable: enrollment, notification_type: :system,
                    title: "You've been added to #{@cohort.name}",
                    body: "Open your cohort workspace to see your class, schedule, and messages.", path: "/cohorts/#{@cohort.id}")
                end
                result.merge(status: created ? "enrolled" : "already_enrolled", invitation_status: invitation&.status, error: invitation&.error).compact
              end
            rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique, ArgumentError => error
              result.merge(status: "error", error: error.is_a?(ArgumentError) ? error.message : "Could not save this row")
            end
          end
        end
        render json: { results: results }
      end

      # PATCH /api/v1/enrollments/:id
      def update
        updated = @enrollment.user.with_lock { @enrollment.update(enrollment_params) }
        if updated
          render json: { enrollment: enrollment_json(@enrollment) }
        else
          render json: { errors: @enrollment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/enrollments/:id
      def destroy
        if @enrollment.destroy
          head :no_content
        else
          render json: { errors: @enrollment.errors.full_messages }, status: :conflict
        end
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def set_enrollment
        @enrollment = Enrollment.find(params[:id])
      end

      def enrollment_params
        params.permit(:status)
      end

      def dispatch_invitation(user)
        return unless ActiveModel::Type::Boolean.new.cast(params[:send_invite])
        return UserInvitationDispatchService::Result.new(status: "not_needed", error: nil) unless user.invite_pending?

        UserInvitationDispatchService.new(user: user, invited_by: current_user).call
      rescue StandardError
        UserInvitationDispatchService::Result.new(status: "failed", error: "Invitation failed. Retry from the cohort roster.")
      end

      def assign_bulk_content_defaults(enrollment)
        rows = @bulk_modules.filter_map do |mod|
          defaults = @cohort.content_defaults[mod.id.to_s]
          next unless defaults && defaults["assigned"]

          { enrollment_id: enrollment.id, module_id: mod.id, unlocked: defaults["unlocked"], unlock_date_override: defaults["unlock_date_override"], availability_changed_at: Time.current }
        end
        ModuleAssignment.insert_all(rows) if rows.any?
      end

      def enrollment_json(enrollment, include_progress: false)
        json = {
          id: enrollment.id,
          user_id: enrollment.user_id,
          cohort_id: enrollment.cohort_id,
          user_name: enrollment.user.full_name,
          user_email: enrollment.user.email,
          status: enrollment.status,
          invited_at: enrollment.invited_at,
          joined_at: enrollment.joined_at,
          enrolled_at: enrollment.enrolled_at,
          completed_at: enrollment.completed_at,
          access_expires_at: enrollment.access_expires_at,
          support_expires_at: enrollment.support_expires_at,
          module_assignments: enrollment.module_assignments.includes(:curriculum_module).map { |assignment|
            {
              id: assignment.id,
              module_id: assignment.module_id,
              module_name: assignment.curriculum_module.name,
              unlocked: assignment.unlocked,
              unlock_date_override: assignment.unlock_date_override
            }
          }
        }

        if include_progress
          # Calculate progress for this enrollment
          completion_block_ids = AssignedLearningContent.new(enrollment).completion_block_ids

          completed_blocks = Progress.completed
            .where(enrollment_id: enrollment.id, content_block_id: completion_block_ids)

          json[:total_blocks] = completion_block_ids.count
          json[:completed_blocks] = completed_blocks.count
          json[:progress_percentage] = completion_block_ids.count > 0 ? (completed_blocks.count.to_f / completion_block_ids.count * 100).round(1) : 0
        end

        json
      end
    end
  end
end
