class EnableMessageEmailNotificationsByDefault < ActiveRecord::Migration[8.1]
  def up
    change_column_default :users, :message_email_notifications_enabled, from: false, to: true

    # The original preference was false for every user without a browser push
    # subscription, so email notifications could never be default-on. Reset the
    # rollout once; future opt-outs are preserved by the explicit preference API.
    execute <<~SQL.squish
      UPDATE users
      SET message_email_notifications_enabled = TRUE
      WHERE message_email_notifications_enabled = FALSE
    SQL
  end

  def down
    # The up migration intentionally replaces both the legacy default-false
    # state and any explicit opt-outs. Without a pre-migration snapshot, a down
    # migration cannot distinguish those users and restore their preferences.
    raise ActiveRecord::IrreversibleMigration, <<~MESSAGE.squish
      Existing message email notification preferences cannot be restored safely.
      Restore a pre-migration database snapshot before rolling back this migration.
    MESSAGE
  end
end
