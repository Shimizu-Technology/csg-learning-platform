class CreateCableTokenNonces < ActiveRecord::Migration[8.1]
  def change
    create_table :cable_token_nonces do |t|
      t.references :user, null: false, foreign_key: true
      t.string :nonce, null: false
      t.datetime :expires_at, null: false
      t.datetime :used_at

      t.timestamps
    end

    add_index :cable_token_nonces, :nonce, unique: true
    add_index :cable_token_nonces, :expires_at
  end
end
