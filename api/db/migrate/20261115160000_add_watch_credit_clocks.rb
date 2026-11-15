class AddWatchCreditClocks < ActiveRecord::Migration[8.1]
  def change
    [ :progresses, :watch_progresses ].each do |table|
      add_column table, :watch_credit_at, :datetime
      add_column table, :watch_credit_fraction, :float, default: 0, null: false
    end
  end
end
