class CreateEnrollments < ActiveRecord::Migration[8.1]
  def change
    create_table :enrollments do |t|
      t.references :user, null: false, foreign_key: true
      t.references :cohort, null: false, foreign_key: true
      t.integer :status, default: 0, null: false
      t.datetime :enrolled_at
      t.datetime :completed_at

      t.timestamps
    end

    add_index :enrollments, [:user_id, :cohort_id], unique: true
  end
end
