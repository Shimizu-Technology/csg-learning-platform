class AddEmailApplicationToMessageSends < ActiveRecord::Migration[8.1]
  def change
    # No default/backfill: old send identities must keep their untagged payload.
    # Only the new application's before-create callback sets the marker.
    [ :messages, :notifications ].each do |table|
      add_column table, :email_application, :string, limit: 16
      add_check_constraint table, "email_application IS NULL OR email_application = 'csg_learn'",
        name: "#{table}_email_application_valid"
    end
  end
end
