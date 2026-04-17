class NullifyUploadedByOnRecordings < ActiveRecord::Migration[8.1]
  def up
    # Allow uploader to be nullified when the user is deleted.
    change_column_null :recordings, :uploaded_by_id, true

    # Replace the existing FK with one that nullifies on user deletion so
    # destroying an uploader doesn't raise PG::ForeignKeyViolation.
    remove_foreign_key :recordings, column: :uploaded_by_id
    add_foreign_key :recordings, :users, column: :uploaded_by_id, on_delete: :nullify
  end

  def down
    remove_foreign_key :recordings, column: :uploaded_by_id
    change_column_null :recordings, :uploaded_by_id, false
    add_foreign_key :recordings, :users, column: :uploaded_by_id
  end
end
