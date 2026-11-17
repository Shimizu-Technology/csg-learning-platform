require "test_helper"
require Rails.root.join("db/migrate/20261118040000_add_scheduling_to_announcements").to_s

class AddSchedulingToAnnouncementsTest < ActiveSupport::TestCase
  test "additive scheduling migration keeps existing updates and can run twice" do
    migration = AddSchedulingToAnnouncements.new
    author = User.create!(clerk_id: "migration_scheduler", email: "migration-scheduler@example.com", first_name: "Migration", last_name: "Synthetic", role: :admin)
    migration.migrate(:down)
    Announcement.reset_column_information
    assert_not Announcement.column_names.include?("scheduled_for")
    # The model now validates the new columns, so the old row goes in as SQL.
    id = Announcement.insert!({ title: "Before", body: "Words", author_id: author.id, audience: 1, status: 0, created_at: Time.current, updated_at: Time.current }).first.fetch("id")

    migration.migrate(:up)
    migration.migrate(:up)
    Announcement.reset_column_information
    existing = Announcement.find(id)
    assert_nil existing.scheduled_for
    assert_nil existing.scheduled_by_id
    assert_equal false, existing.scheduled_send_push
    connection = ActiveRecord::Base.connection
    assert connection.foreign_key_exists?(:announcements, name: "fk_announcements_scheduled_by")
    index = connection.indexes(:announcements).find { |item| item.name == "index_announcements_on_scheduled_for_due" }
    assert_equal "((status = 0) AND (scheduled_for IS NOT NULL))", index.where
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Announcement.reset_column_information
  end
end
