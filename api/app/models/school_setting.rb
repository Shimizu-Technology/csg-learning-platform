class SchoolSetting < ApplicationRecord
  validates :public_catalog_mode, inclusion: { in: %w[automatic always hidden] }

  def self.current
    find_by(id: 1) || create_or_find_by!(id: 1)
  end
end
