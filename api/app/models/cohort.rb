class Cohort < ApplicationRecord
  enum :cohort_type, { bootcamp: 0, workshop: 1, alumni: 2, custom: 3 }
  enum :status, { upcoming: 0, active: 1, completed: 2, archived: 3 }

  belongs_to :curriculum
  has_many :enrollments, dependent: :destroy
  has_many :users, through: :enrollments
  has_many :recordings, dependent: :destroy
  has_many :announcements, dependent: :destroy
  has_many :channels, dependent: :destroy
  has_many :direct_conversations, dependent: :destroy

  validates :name, presence: true
  validates :start_date, presence: true

  after_create :create_default_channel

  private

  def create_default_channel
    channels.find_or_create_by!(name: "Class Chat") do |channel|
      channel.description = "General class discussion for this cohort."
      channel.visibility = :cohort
      channel.status = :active
      channel.position = 0
    end
  end
end
