class AddPublishedToLessonsAndResolutionNoteToContentReports < ActiveRecord::Migration[8.1]
  def change
    add_column :lessons, :published, :boolean, default: true, null: false
    add_column :content_reports, :resolution_note, :text
  end
end
