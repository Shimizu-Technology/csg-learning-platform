class SchoolSetting < ApplicationRecord
  validates :public_catalog_mode, inclusion: { in: %w[automatic always hidden] }

  validates :review_response_time, presence: true, length: { maximum: 200 }

  def self.current
    return load_current unless RequestCache.enabled

    RequestCache.school_setting ||= load_current
  end

  class RequestCache < ActiveSupport::CurrentAttributes
    attribute :enabled, :school_setting
  end

  def self.load_current
    # Isolate a failed lazy INSERT so reads can continue in an outer transaction.
    find_by(id: 1) || transaction(requires_new: true) { create_or_find_by!(id: 1) }
  rescue ActiveRecord::StatementInvalid, ActiveRecord::ReadOnlyError, ActiveRecord::RecordInvalid
    new(id: 1, features: {}, public_catalog_mode: "automatic")
  end
end
