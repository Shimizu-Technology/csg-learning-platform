module Api
  module V1
    class OfficeHoursController < ApplicationController
      class InvalidOfficeHourTime < StandardError; end

      OFFSET_TIME_PATTERN = /(Z|[+-]\d{2}:?\d{2})\z/i
      LOCAL_TIME_PATTERN = /\A(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\z/

      before_action :authenticate_user!
      before_action :set_cohort
      before_action :authorize_cohort_read!, only: [ :index ]
      before_action :require_staff!, except: [ :index ]
      before_action :set_office_hour, only: [ :update, :destroy ]

      # GET /api/v1/cohorts/:cohort_id/office_hours
      def index
        office_hours = OfficeHourSerializer.active_for(@cohort)
        render json: {
          office_hours: office_hours.map { |office_hour| OfficeHourSerializer.as_json(office_hour) },
          upcoming: OfficeHourSerializer.upcoming(office_hours, limit: 6)
        }
      end

      # POST /api/v1/cohorts/:cohort_id/office_hours
      def create
        office_hour = @cohort.office_hours.new(office_hour_params)
        office_hour.created_by = current_user

        if office_hour.save
          render json: { office_hour: OfficeHourSerializer.as_json(office_hour) }, status: :created
        else
          render json: { errors: office_hour.errors.full_messages }, status: :unprocessable_entity
        end
      rescue InvalidOfficeHourTime => e
        render json: { errors: [ e.message ] }, status: :unprocessable_entity
      end

      # PATCH /api/v1/cohorts/:cohort_id/office_hours/:id
      def update
        if @office_hour.update(office_hour_params)
          render json: { office_hour: OfficeHourSerializer.as_json(@office_hour) }
        else
          render json: { errors: @office_hour.errors.full_messages }, status: :unprocessable_entity
        end
      rescue InvalidOfficeHourTime => e
        render json: { errors: [ e.message ] }, status: :unprocessable_entity
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
        permitted = params.permit(:title, :description, :starts_at, :ends_at, :meeting_url, :timezone, :recurrence, :active)
        timezone = permitted[:timezone].presence || @office_hour&.timezone || OfficeHour::DEFAULT_TIMEZONE
        zone = Time.find_zone!(timezone)

        permitted[:timezone] = timezone
        permitted[:starts_at] = parse_time_in_zone(permitted[:starts_at], zone, "Start time") if permitted.key?(:starts_at)
        permitted[:ends_at] = parse_time_in_zone(permitted[:ends_at], zone, "End time") if permitted.key?(:ends_at)
        permitted
      rescue ArgumentError
        raise InvalidOfficeHourTime, "Timezone is invalid"
      end

      def parse_time_in_zone(raw_value, zone, label)
        return nil if raw_value.blank?

        raw = raw_value.to_s.strip
        return Time.iso8601(raw) if raw.match?(OFFSET_TIME_PATTERN)

        match = LOCAL_TIME_PATTERN.match(raw)
        raise InvalidOfficeHourTime, "#{label} is invalid" unless match

        year, month, day, hour, minute, second = match.captures.map { |part| part&.to_i }
        local_wall_time = Time.utc(year, month, day, hour, minute, second || 0)
        zone.tzinfo.local_to_utc(local_wall_time)
      rescue ArgumentError, TZInfo::PeriodNotFound, TZInfo::AmbiguousTime
        raise InvalidOfficeHourTime, "#{label} is invalid in #{zone.tzinfo.name}"
      end
    end
  end
end
