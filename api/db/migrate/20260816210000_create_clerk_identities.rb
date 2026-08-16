class CreateClerkIdentities < ActiveRecord::Migration[8.1]
  def change
    create_table :clerk_identities do |t|
      t.references :user, null: false, foreign_key: true
      t.string :issuer, null: false
      t.string :clerk_user_id, null: false
      t.datetime :last_seen_at

      t.timestamps
    end

    add_index :clerk_identities, [ :issuer, :clerk_user_id ], unique: true
    add_index :clerk_identities, [ :user_id, :issuer ], unique: true
  end
end
