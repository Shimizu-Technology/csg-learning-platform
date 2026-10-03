class AddCoursePackageIdentityToCurricula < ActiveRecord::Migration[8.1]
  def change
    add_column :curricula, :course_package_key, :string
    add_column :curricula, :course_package_revision, :string
    add_column :curricula, :course_package_digest, :string
    add_column :curricula, :course_package_content_snapshot, :string
    add_index :curricula, :course_package_key, unique: true
    add_column :modules, :course_package_key, :string
    add_index :modules, [ :curriculum_id, :course_package_key ], unique: true
  end
end
