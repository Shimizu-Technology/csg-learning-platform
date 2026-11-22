class CreateCertificatesAndCompletion < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      create_table :certificates, if_not_exists: true do |t|
        t.references :enrollment, null: false, index: false, foreign_key: { on_delete: :cascade }
        t.string :code, null: false
        t.string :holder_name, null: false
        t.string :course_title, null: false
        t.string :issuer_name, null: false
        t.integer :wording_version, default: 1, null: false
        t.datetime :issued_at, null: false
        t.references :issued_by, index: false, foreign_key: { to_table: :users, on_delete: :nullify }
        t.text :issuance_reason
        t.datetime :revoked_at
        t.references :revoked_by, index: false, foreign_key: { to_table: :users, on_delete: :nullify }
        t.text :revocation_reason
      end
      add_index :certificates, :code, unique: true, if_not_exists: true
      add_index :certificates, :enrollment_id, if_not_exists: true
      add_index :certificates, :enrollment_id, unique: true, where: "revoked_at IS NULL",
        name: "index_certificates_on_active_enrollment_id", if_not_exists: true
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :certificates, if_exists: true
    end
  end
end
