class AddGuidedAccessDatesToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_column :cohorts, :guided_access_ends_on, :date
    add_column :cohorts, :guided_support_ends_on, :date
  end
end
