class UserBlock < ApplicationRecord
  belongs_to :blocker, class_name: "User"
  belongs_to :blocked_user, class_name: "User"

  validates :blocked_user_id, uniqueness: { scope: :blocker_id }
  validate :different_users

  scope :between, ->(first_user_id, second_user_ids) {
    ids = Array(second_user_ids).map(&:to_i).uniq
    where(blocker_id: first_user_id, blocked_user_id: ids)
      .or(where(blocker_id: ids, blocked_user_id: first_user_id))
  }

  def self.related_user_ids(first_user_id, candidate_user_ids)
    candidates = Array(candidate_user_ids).map(&:to_i).uniq
    return [] if candidates.empty?

    between(first_user_id, candidates)
      .pluck(:blocker_id, :blocked_user_id)
      .flatten
      .uniq
      .intersection(candidates)
  end

  private

  def different_users
    errors.add(:blocked_user, "cannot be yourself") if blocker_id.present? && blocker_id == blocked_user_id
  end
end
