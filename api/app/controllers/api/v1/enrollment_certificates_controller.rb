module Api
  module V1
    class EnrollmentCertificatesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_owned_enrollment, only: [ :show, :update ]
      before_action :require_staff!, only: [ :reissue, :revoke ]
      before_action :set_staff_enrollment, only: [ :reissue, :revoke ]

      rescue_from ActiveRecord::RecordInvalid do |error|
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      rescue_from ArgumentError, CourseCompletion::Unavailable do |error|
        render json: { error: error.message }, status: :unprocessable_entity
      end

      def show
        summary = CourseCompletion.learner_summary(@enrollment)[:course_completion]
        render json: summary || {
          enrollment_id: @enrollment.id, course_completed: false, all_work_handed_in: false, certificate: nil, next_step: nil
        }
      end

      def update
        name = params[:holder_name]
        raise ArgumentError, "Enter a printed name of up to 120 characters" unless name.is_a?(String)

        @enrollment.with_lock do
          certificate = @enrollment.certificates.active.first
          return render json: { error: "There is no active certificate" }, status: :not_found unless certificate

          certificate.update!(holder_name: name)
          render json: { certificate: certificate.verification_json }
        end
      end

      def reissue
        certificate = CourseCompletion.reissue!(@enrollment, actor: current_user, reason: required_reason)
        render json: { certificate: certificate.verification_json }
      end

      def revoke
        certificate = CourseCompletion.revoke!(@enrollment, actor: current_user, reason: required_reason)
        render json: { certificate: certificate.verification_json }
      end

      private

      def set_owned_enrollment
        @enrollment = current_user.enrollments.find(params[:enrollment_id])
      end

      def set_staff_enrollment
        @enrollment = Enrollment.find(params[:enrollment_id])
        require_cohort_access!(@enrollment.cohort, teacher: true)
      end

      def required_reason
        reason = params[:reason]
        return reason.strip if reason.is_a?(String) && reason.present? && reason.length <= 1000

        raise ArgumentError, "Enter a reason of up to 1,000 characters"
      end
    end
  end
end
