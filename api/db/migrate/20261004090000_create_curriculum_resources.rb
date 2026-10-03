class CreateCurriculumResources < ActiveRecord::Migration[8.1]
  def change
    create_table :curriculum_resources do |t|
      t.references :curriculum, null: false, foreign_key: { to_table: :curricula }
      t.string :title, null: false
      t.string :filename, null: false
      t.string :s3_key, null: false
      t.string :upload_key, null: false
      t.bigint :file_size, null: false
      t.boolean :ready, null: false, default: false
      t.datetime :upload_expires_at, null: false
      t.timestamps
    end
    add_index :curriculum_resources, :s3_key, unique: true
    add_index :curriculum_resources, :upload_key, unique: true
  end
end
