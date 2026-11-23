class AddCompletedVideoSectionsToProgresses < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      add_column :progresses, :completed_video_sections, :jsonb, default: {}, null: false unless column_exists?(:progresses, :completed_video_sections)
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_column :progresses, :completed_video_sections if column_exists?(:progresses, :completed_video_sections)
    end
  end
end
