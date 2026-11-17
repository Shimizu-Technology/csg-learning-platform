require "test_helper"
require Rails.root.join("db/migrate/20261118120000_add_editor_preferences_to_users").to_s

class AddEditorPreferencesToUsersTest < ActiveSupport::TestCase
  test "additive editor preference columns leave existing people unset and can run twice" do
    migration = AddEditorPreferencesToUsers.new
    migration.migrate(:down)
    User.reset_column_information
    assert_not User.column_names.include?("editor_mode")
    id = User.insert!({ clerk_id: "editor_migration", email: "editor-migration@example.invalid", role: 0, created_at: Time.current, updated_at: Time.current }).first.fetch("id")

    migration.migrate(:up)
    migration.migrate(:up)
    User.reset_column_information
    existing = User.find(id)
    assert_nil existing.editor_mode, "people who never chose keep no stored mode"
    assert_nil existing.editor_enter_sends
    assert_raises(ActiveRecord::StatementInvalid) { User.transaction(requires_new: true) { existing.update_column(:editor_mode, "wysiwyg") } }
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    User.reset_column_information
  end
end
