require "uri"

class PrivateMeetingBooking < ApplicationRecord
  enum :status, { confirmed: 0, canceled: 1 }

  belongs_to :private_meeting_slot
  belongs_to :enrollment
  belongs_to :cohort
  belongs_to :instructor, class_name: "User"
  belongs_to :student, class_name: "User"
  has_many :private_meeting_booking_events, dependent: :destroy

  validates :week_number, presence: true
  validate :zoom_url_is_http

  private

  def zoom_url_is_http
    return if zoom_url.blank?

    uri = URI.parse(zoom_url)
    errors.add(:zoom_url, "must be an HTTPS URL") unless uri.is_a?(URI::HTTPS) && uri.host.present?
  rescue URI::InvalidURIError
    errors.add(:zoom_url, "must be an HTTPS URL")
  end
end
