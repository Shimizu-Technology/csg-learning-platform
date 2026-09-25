class PrivateMeetingBookingEvent < ApplicationRecord
  belongs_to :private_meeting_booking
  belongs_to :actor, class_name: "User"
  has_many :notifications, as: :notifiable, dependent: :destroy

  validates :action, presence: true
end
