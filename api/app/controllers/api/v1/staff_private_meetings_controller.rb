module Api
  module V1
    class StaffPrivateMeetingsController < ApplicationController
      include PrivateMeetingErrorHandling

      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!

      # Admins see every cohort's meetings. An instructor sees the meetings they
      # host, plus `other_cohorts`: the cohorts they teach where someone else
      # hosts meetings or no host is set yet, with who to ask (U-4.10). Hosts
      # stay admin-assigned; `other_cohorts` names people and never includes
      # another host's slots, bookings or students.
      def index
        configs = PrivateMeetingConfig.includes(:cohort, :instructor).order(created_at: :desc)
        configs = configs.where(instructor_id: current_user.id, cohort_id: current_user.accessible_cohorts.select(:id)) unless current_user.admin?
        configs = configs.where(cohort_id: params[:cohort_id]) if params[:cohort_id].present?
        configs = configs.to_a
        cohort_ids = configs.map(&:cohort_id)
        slots = PrivateMeetingSlot.active.where(private_meeting_config_id: configs.map(&:id)).includes(:instructor).order(:starts_at).to_a.group_by(&:private_meeting_config_id)
        # Capacity is independent of the student/history filter. Another
        # learner's confirmed booking still occupies its slot.
        occupied = PrivateMeetingBooking.where(cohort_id: cohort_ids, status: :confirmed)
          .pluck(:cohort_id, :private_meeting_slot_id).group_by(&:first)
          .transform_values { |pairs| pairs.map(&:last) }
        booking_scope = PrivateMeetingBooking.where(cohort_id: cohort_ids)
        booking_scope = booking_scope.where(instructor_id: current_user.id) unless current_user.admin?
        booking_scope = booking_scope.where(student_id: params[:student_id]) if params[:student_id].present?
        bookings = booking_scope.includes(:instructor, :student).order(:starts_at).to_a.group_by(&:cohort_id)
        render json: {
          cohorts: configs.map do |config|
            cohort_bookings = bookings.fetch(config.cohort_id, [])
            booked_ids = occupied.fetch(config.cohort_id, [])
            {
              id: config.cohort_id,
              name: config.cohort.name,
              start_date: config.cohort.start_date,
              end_date: config.cohort.end_date,
              instructor_id: config.instructor_id,
              instructor_name: config.instructor.full_name,
              weeks: config.weeks,
              timezone: config.timezone,
              reschedule_cutoff_hours: config.reschedule_cutoff_hours,
              max_student_changes: config.max_student_changes,
              slots: slots.fetch(config.id, []).map { |slot| PrivateMeetingSerializer.slot(slot, booked_ids: booked_ids) },
              bookings: cohort_bookings.map { |booking| PrivateMeetingSerializer.booking(booking, staff: true) }
            }
          end,
          other_cohorts: other_cohorts(cohort_ids),
          admin_contacts: current_user.admin? ? [] : admin_contacts
        }
      end

      def update
        booking = PrivateMeetingBooking.includes(cohort: :private_meeting_config).find(params[:id])
        unless current_user.admin? || (booking.instructor_id == current_user.id && current_user.can_teach_cohort?(booking.cohort))
          render_forbidden("This meeting belongs to another instructor")
          return
        end

        actions = [ params[:slot_id].present?, params.key?(:zoom_url), params[:status].present? ]
        unless actions.count(true) == 1 && (params[:status].blank? || params[:status] == "canceled")
          render json: { error: "Change one meeting detail at a time" }, status: :unprocessable_entity
          return
        end

        if params[:slot_id].present?
          slot = PrivateMeetingSlot.find(params[:slot_id])
          booking = PrivateMeetingScheduler.reschedule!(booking: booking, slot: slot, actor: current_user)
        elsif params.key?(:zoom_url)
          booking.update!(zoom_url: params[:zoom_url].presence)
          PrivateMeetingScheduler.event!(booking, current_user, "link_updated")
        else
          PrivateMeetingScheduler.cancel!(booking: booking, actor: current_user)
        end
        render json: { booking: PrivateMeetingSerializer.booking(booking.reload, staff: true) }
      end

      private

      # Running cohorts this instructor teaches with meetings switched on that
      # they don't host. Self-paced courses have no meetings.
      def other_cohorts(hosted_cohort_ids)
        return [] if current_user.admin?

        school = FeatureSwitches.school
        current_user.accessible_cohorts.where(status: %i[upcoming active]).where.not(id: hosted_cohort_ids)
          .includes(private_meeting_config: :instructor).order(:start_date, :id).to_a
          .reject { |cohort| cohort.self_paced? || !FeatureSwitches.for(cohort: cohort, school: school)["private_meetings"] }
          .map do |cohort|
            host = cohort.private_meeting_config&.instructor
            { id: cohort.id, name: cohort.name, host: host && { id: host.id, full_name: host.full_name } }
          end
      end

      # Who can enable meetings or change the host: the school's admins.
      def admin_contacts
        User.not_archived.admin.order(:first_name, :last_name, :id).limit(3).map { |admin| { id: admin.id, full_name: admin.full_name } }
      end
    end
  end
end
