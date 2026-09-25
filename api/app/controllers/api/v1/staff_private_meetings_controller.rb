module Api
  module V1
    class StaffPrivateMeetingsController < ApplicationController
      include PrivateMeetingErrorHandling

      before_action :authenticate_user!
      before_action :require_staff!

      def index
        configs = PrivateMeetingConfig.includes(:cohort, :instructor).order(created_at: :desc)
        configs = configs.where(instructor_id: current_user.id) unless current_user.admin?
        render json: {
          cohorts: configs.map do |config|
            slots = config.private_meeting_slots.active.includes(:instructor).order(:starts_at).to_a
            bookings = PrivateMeetingBooking.where(cohort_id: config.cohort_id).includes(:instructor, :student).order(:starts_at).to_a
            booked_ids = bookings.select(&:confirmed?).map(&:private_meeting_slot_id)
            {
              id: config.cohort_id,
              name: config.cohort.name,
              start_date: config.cohort.start_date,
              end_date: config.cohort.end_date,
              instructor_id: config.instructor_id,
              instructor_name: config.instructor.full_name,
              weeks: config.weeks,
              slots: slots.map { |slot| PrivateMeetingSerializer.slot(slot, booked_ids: booked_ids) },
              bookings: bookings.map { |booking| PrivateMeetingSerializer.booking(booking, staff: true) }
            }
          end
        }
      end

      def update
        booking = PrivateMeetingBooking.includes(cohort: :private_meeting_config).find(params[:id])
        unless current_user.admin? || booking.instructor_id == current_user.id
          render_forbidden("This meeting belongs to another instructor")
          return
        end

        if params[:slot_id].present?
          slot = PrivateMeetingSlot.find(params[:slot_id])
          booking = PrivateMeetingScheduler.reschedule!(booking: booking, slot: slot, actor: current_user)
        end
        if params.key?(:zoom_url)
          booking.update!(zoom_url: params[:zoom_url].presence)
          PrivateMeetingScheduler.event!(booking, current_user, "link_updated")
        end
        if params[:status] == "canceled"
          PrivateMeetingScheduler.cancel!(booking: booking, actor: current_user)
        end
        render json: { booking: PrivateMeetingSerializer.booking(booking.reload, staff: true) }
      end
    end
  end
end
