class RepairUserRoleEnumAndOwnerAdmin < ActiveRecord::Migration[8.1]
  OWNER_EMAILS = [ "codeschoolofguam@gmail.com" ].freeze
  INSTRUCTOR_EMAILS = [ "alanna@anyonecanlearntocode.com" ].freeze

  def up
    role_column = connection.columns(:users).find { |column| column.name == "role" }

    unless role_column&.type == :integer
      add_column :users, :role_integer, :integer, default: 0, null: false

      execute <<~SQL.squish
        UPDATE users
        SET role_integer = CASE
          WHEN LOWER(email) IN (#{quoted_emails(OWNER_EMAILS)}) THEN 2
          WHEN LOWER(email) IN (#{quoted_emails(INSTRUCTOR_EMAILS)}) THEN 1
          WHEN LOWER(COALESCE(role::text, '')) IN ('2', 'admin', 'campaign_admin') THEN 2
          WHEN LOWER(COALESCE(role::text, '')) IN ('1', 'instructor') THEN 1
          ELSE 0
        END
      SQL

      remove_index :users, :role if index_exists?(:users, :role)
      remove_column :users, :role
      rename_column :users, :role_integer, :role
      add_index :users, :role unless index_exists?(:users, :role)
    end

    execute <<~SQL.squish
      UPDATE users SET role = 2 WHERE LOWER(email) IN (#{quoted_emails(OWNER_EMAILS)})
    SQL
  end

  def down
    # Intentionally irreversible: this repairs invalid legacy role data to the
    # current integer enum contract.
  end

  private

  def quoted_emails(emails)
    emails.map { |email| connection.quote(email.downcase) }.join(", ")
  end
end
