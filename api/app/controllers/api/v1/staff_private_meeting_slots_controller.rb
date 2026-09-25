module Api
  module V1
    class StaffPrivateMeetingSlotsController < ApplicationController
      include PrivateMeetingErrorHandling

      before_action :authenticate_user!
      before_action :require_staff!

      def create
        config = PrivateMeetingConfig.find_by!(cohort_id: params.require(:cohort_id))
        return render_forbidden("This class belongs to another instructor") unless can_manage?(config)

        raw_start = params.require(:starts_at).to_s
        unless Iso8601TimeInput.explicit_offset?(raw_start)
          render json: { error: "Start time must include a UTC offset" }, status: :unprocessable_entity
          return
        end
        start_time = Time.iso8601(raw_start)
        repeat_weeks = Integer(params[:repeat_weeks] || 1)
        unless repeat_weeks.between?(1, config.weeks)
          render json: { error: "Repeat count must be between 1 and #{config.weeks}" }, status: :unprocessable_entity
          return
        end

        slots = []
        config.instructor.with_lock do
          repeat_weeks.times do |index|
            starts_at = start_time + index.weeks
            slots << config.private_meeting_slots.create!(
              instructor: config.instructor,
              starts_at: starts_at,
              ends_at: starts_at + config.duration_minutes.minutes
            )
          end
        end
        render json: { slots: slots.map { |slot| PrivateMeetingSerializer.slot(slot) } }, status: :created
      rescue ArgumentError
        render json: { error: "Start time or repeat count is invalid" }, status: :unprocessable_entity
      end

      def destroy
        slot = PrivateMeetingSlot.includes(:private_meeting_config).find(params[:id])
        return render_forbidden("This class belongs to another instructor") unless can_manage?(slot.private_meeting_config)

        slot.instructor.with_lock do
          slot.reload.lock!
          raise PrivateMeetingScheduler::Conflict, "Move or cancel the booked meeting before removing this time" if slot.booked?

          slot.update!(active: false)
        end
        head :no_content
      end

      private

      def can_manage?(config)
        current_user.admin? || config.instructor_id == current_user.id
      end
    end
  end
end
