module Api
  module V1
    class ProfileController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      # GET /api/v1/profile
      def show
        enrollments = current_user.enrollments.includes(:active_certificate, cohort: { curriculum: { cohort_copy: :cohort } })
        purchases = current_user.course_purchases.where(status: "paid").index_by(&:cohort_id)
        readable_ids = current_user.enrollments.with_read_access.pluck(:id).to_set
        school = FeatureSwitches.school

        render json: {
          user: {
            id: current_user.id,
            email: current_user.email,
            first_name: current_user.first_name,
            last_name: current_user.last_name,
            full_name: current_user.full_name,
            role: current_user.role,
            github_username: current_user.github_username,
            **(current_user.github_identity_verified? ? { github_identity: GithubAppSerializer.identity(current_user) } : {}),
            avatar_url: current_user.avatar_url,
            handle: current_user.handle
          },
          enrollments: enrollments.map { |e|
            features = FeatureSwitches.for(cohort: e.cohort, school: school)
            {
              id: e.id,
              cohort_id: e.cohort_id,
              cohort_name: e.cohort.name,
              curriculum_name: CurriculumName.in_cohort(e.cohort),
              status: e.status,
              enrolled_at: e.enrolled_at,
              **(GithubRepositoryAccess.enabled?(e.cohort) ? { github_app_enabled: true } : {}),
              # Only where reminders are on (W9.3), so other learners' payloads are unchanged.
              **(LearnerNudges.enabled_for?(e.cohort, school: school) ? { learner_nudges_enabled: true } : {}),
              # Withdrawn or expired enrollments no longer open the cohort, so they show as text.
              can_open: readable_ids.include?(e.id),
              **(features["student_experience_v2"] == true ? { purchase_id: purchases[e.cohort_id]&.id, access_expires_at: e.access_expires_at } : {}),
              **CourseCompletion.learner_summary(e, features: features)
            }
          }
        }
      end

      # PATCH /api/v1/profile
      def update
        saved = if profile_params.key?(:github_username)
          current_user.with_lock do
            if current_user.github_username_change_warning(profile_params[:github_username])
              current_user.errors.add(:github_username, "is verified; reconnect GitHub to change it")
              false
            else
              current_user.update(profile_params)
            end
          end
        else
          current_user.update(profile_params)
        end
        if saved
          render json: {
            user: {
              id: current_user.id,
              email: current_user.email,
              first_name: current_user.first_name,
              last_name: current_user.last_name,
              full_name: current_user.full_name,
              github_username: current_user.github_username,
              **(current_user.github_identity_verified? ? { github_identity: GithubAppSerializer.identity(current_user) } : {}),
              avatar_url: current_user.avatar_url,
              handle: current_user.handle
            }
          }
        else
          render json: { errors: current_user.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        # Two people saved the same handle at once; the unique index kept one.
        render json: { errors: [ "Handle has already been taken" ] }, status: :unprocessable_entity
      end

      private

      def profile_params
        params.permit(:github_username, :avatar_url, :handle)
      end
    end
  end
end
