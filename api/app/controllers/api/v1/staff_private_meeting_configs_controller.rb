module Api
  module V1
    class StaffPrivateMeetingConfigsController < ApplicationController
      include PrivateMeetingErrorHandling

      before_action :authenticate_user!
      before_action :require_admin!

      def create
        cohort = Cohort.find(params.require(:cohort_id))
        instructor = User.find(params.require(:instructor_id))
        config = PrivateMeetingConfig.create!(cohort: cohort, instructor: instructor)
        render json: { config: { id: config.id, cohort_id: cohort.id, instructor_id: instructor.id } }, status: :created
      end
    end
  end
end
