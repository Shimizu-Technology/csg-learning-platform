class AddScheduleDaysToModules < ActiveRecord::Migration[8.1]
  def change
    add_column :modules, :schedule_days, :string, default: "weekdays", null: false
  end
end
