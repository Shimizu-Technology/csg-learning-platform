require "test_helper"
require Rails.root.join("db/migrate/20260718000100_enable_message_email_notifications_by_default").to_s

class EnableMessageEmailNotificationsByDefaultTest < ActiveSupport::TestCase
  test "rollback is explicitly blocked because prior preferences cannot be reconstructed" do
    error = assert_raises(ActiveRecord::IrreversibleMigration) do
      EnableMessageEmailNotificationsByDefault.new.down
    end

    assert_includes error.message, "Restore a pre-migration database snapshot"
  end
end
