class AddRequiresSubmissionToLessons < ActiveRecord::Migration[8.1]
  def change
    add_column :lessons, :requires_submission, :boolean, default: false, null: false
  end
end
