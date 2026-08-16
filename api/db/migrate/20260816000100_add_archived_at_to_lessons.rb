class AddArchivedAtToLessons < ActiveRecord::Migration[8.1]
  def change
    add_column :lessons, :archived_at, :datetime
    add_index :lessons, [ :module_id, :archived_at, :release_day, :position ],
      name: "index_lessons_on_module_archive_and_order"
  end
end
