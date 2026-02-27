module Api
  module V1
    class EnrollmentsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!
      before_action :set_cohort, only: [:index, :create]
      before_action :set_enrollment, only: [:show, :update, :destroy]

      # GET /api/v1/cohorts/:cohort_id/enrollments
      def index
        enrollments = @cohort.enrollments.includes(:user)
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
        enrollment = @cohort.enrollments.new(user: user)

        if enrollment.save
          # Create module assignments for all curriculum modules
          @cohort.curriculum.modules.each do |mod|
            ModuleAssignment.create(enrollment: enrollment, curriculum_module: mod)
          end

          render json: { enrollment: enrollment_json(enrollment) }, status: :created
        else
          render json: { errors: enrollment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/enrollments/:id
      def update
        if @enrollment.update(enrollment_params)
          render json: { enrollment: enrollment_json(@enrollment) }
        else
          render json: { errors: @enrollment.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/enrollments/:id
      def destroy
        @enrollment.destroy
        head :no_content
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

      def enrollment_json(enrollment, include_progress: false)
        json = {
          id: enrollment.id,
          user_id: enrollment.user_id,
          cohort_id: enrollment.cohort_id,
          user_name: enrollment.user.full_name,
          user_email: enrollment.user.email,
          status: enrollment.status,
          enrolled_at: enrollment.enrolled_at,
          completed_at: enrollment.completed_at
        }

        if include_progress
          # Calculate progress for this enrollment
          curriculum = enrollment.cohort.curriculum
          all_blocks = ContentBlock.joins(lesson: :curriculum_module)
            .where(modules: { curriculum_id: curriculum.id })

          completed_blocks = Progress.completed
            .where(user_id: enrollment.user_id, content_block_id: all_blocks.pluck(:id))

          json[:total_blocks] = all_blocks.count
          json[:completed_blocks] = completed_blocks.count
          json[:progress_percentage] = all_blocks.count > 0 ? (completed_blocks.count.to_f / all_blocks.count * 100).round(1) : 0
        end

        json
      end
    end
  end
end
