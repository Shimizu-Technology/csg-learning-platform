module Api
  module V1
    class PrivateMeetingsController < ApplicationController
      include PrivateMeetingErrorHandling

      before_action :authenticate_user!
      before_action :require_student!

      def index
        enrollments = current_user.enrollments.active.includes(cohort: { private_meeting_config: :instructor })
        cohorts = enrollments.filter_map do |enrollment|
          cohort = enrollment.cohort
          config = cohort.private_meeting_config
          next unless config&.enabled?

          slots = config.private_meeting_slots.active.where("starts_at >= ?", Time.current + config.reschedule_cutoff_hours.hours).includes(:instructor).order(:starts_at).to_a
          booked_ids = PrivateMeetingBooking.confirmed.where(private_meeting_slot_id: slots.map(&:id)).pluck(:private_meeting_slot_id)
          bookings = enrollment.private_meeting_bookings.includes(:instructor).order(:starts_at)
          {
            id: cohort.id,
            name: cohort.name,
            start_date: cohort.start_date,
            end_date: cohort.end_date,
            instructor_name: config.instructor.full_name,
            weeks: config.weeks,
            bookings: bookings.map { |booking| PrivateMeetingSerializer.booking(booking) },
            slots: slots.map { |slot| PrivateMeetingSerializer.slot(slot, booked_ids: booked_ids) }
          }
        end
        render json: { cohorts: cohorts }
      end

      def create
        slot = PrivateMeetingSlot.find(params.require(:slot_id))
        booking = PrivateMeetingScheduler.book!(student: current_user, slot: slot)
        render json: { booking: PrivateMeetingSerializer.booking(booking) }, status: :created
      end

      def update
        booking = current_user.student_private_meeting_bookings.confirmed.find(params[:id])
        slot = PrivateMeetingSlot.find(params.require(:slot_id))
        booking = PrivateMeetingScheduler.reschedule!(booking: booking, slot: slot, actor: current_user)
        render json: { booking: PrivateMeetingSerializer.booking(booking) }
      end

      def destroy
        booking = current_user.student_private_meeting_bookings.confirmed.find(params[:id])
        PrivateMeetingScheduler.cancel!(booking: booking, actor: current_user)
        render json: { booking: PrivateMeetingSerializer.booking(booking.reload) }
      end
    end
  end
end
