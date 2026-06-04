module Api
  module V1
    class OfficeHoursController < ApplicationController
      before_action :authenticate_user!
      before_action :set_cohort
      before_action :authorize_cohort_read!, only: [ :index ]
      before_action :require_staff!, except: [ :index ]
      before_action :set_office_hour, only: [ :update, :destroy ]

      # GET /api/v1/cohorts/:cohort_id/office_hours
      def index
        render json: {
          office_hours: @cohort.office_hours.active.ordered.map { |office_hour| office_hour_json(office_hour) },
          upcoming: upcoming_office_hour_occurrences_json(@cohort, limit: 6)
        }
      end

      # POST /api/v1/cohorts/:cohort_id/office_hours
      def create
        office_hour = @cohort.office_hours.new(office_hour_params)
        office_hour.created_by = current_user

        if office_hour.save
          render json: { office_hour: office_hour_json(office_hour) }, status: :created
        else
          render json: { errors: office_hour.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:cohort_id/office_hours/:id
      def update
        if @office_hour.update(office_hour_params)
          render json: { office_hour: office_hour_json(@office_hour) }
        else
          render json: { errors: @office_hour.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/cohorts/:cohort_id/office_hours/:id
      def destroy
        @office_hour.destroy
        head :no_content
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def set_office_hour
        @office_hour = @cohort.office_hours.find(params[:id])
      end

      def authorize_cohort_read!
        return if current_user.staff?
        return if current_user.enrollments.active.exists?(cohort_id: @cohort.id)

        render_forbidden("Cannot access this cohort")
      end

      def office_hour_params
        params.permit(:title, :description, :starts_at, :ends_at, :meeting_url, :timezone, :recurrence, :active)
      end

      def office_hour_json(office_hour)
        {
          id: office_hour.id,
          cohort_id: office_hour.cohort_id,
          title: office_hour.title,
          description: office_hour.description,
          starts_at: office_hour.starts_at,
          ends_at: office_hour.ends_at,
          meeting_url: office_hour.meeting_url,
          timezone: office_hour.timezone,
          recurrence: office_hour.recurrence,
          active: office_hour.active,
          occurrences: office_hour.upcoming_occurrences(limit: 3).map { |occurrence| occurrence_json(office_hour, occurrence) },
          created_by: office_hour.created_by && {
            id: office_hour.created_by.id,
            full_name: office_hour.created_by.full_name,
            email: office_hour.created_by.email
          }
        }
      end

      def upcoming_office_hour_occurrences_json(cohort, limit: 3)
        cohort.office_hours.active.flat_map do |office_hour|
          office_hour.upcoming_occurrences(limit: limit).map { |occurrence| occurrence_json(office_hour, occurrence) }
        end.sort_by { |occurrence| occurrence[:starts_at] }.first(limit)
      end

      def occurrence_json(office_hour, occurrence)
        {
          office_hour_id: office_hour.id,
          title: office_hour.title,
          description: office_hour.description,
          starts_at: occurrence[:starts_at],
          ends_at: occurrence[:ends_at],
          meeting_url: office_hour.meeting_url,
          timezone: office_hour.timezone,
          recurrence: office_hour.recurrence
        }
      end
    end
  end
end
