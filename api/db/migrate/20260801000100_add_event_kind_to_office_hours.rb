class AddEventKindToOfficeHours < ActiveRecord::Migration[8.1]
  def change
    add_column :office_hours, :event_kind, :integer, null: false, default: 0
    add_index :office_hours, [ :cohort_id, :event_kind, :active ], name: "index_office_hours_on_cohort_kind_and_active"
  end
end
