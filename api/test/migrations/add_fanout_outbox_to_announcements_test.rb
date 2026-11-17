require "test_helper"
require Rails.root.join("db/migrate/20261118150000_add_fanout_outbox_to_announcements").to_s

class AddFanoutOutboxToAnnouncementsTest < ActiveSupport::TestCase
  test "additive fanout outbox migration leaves existing updates without an intent and can run twice" do
    migration = AddFanoutOutboxToAnnouncements.new
    author = User.create!(clerk_id: "migration_outbox", email: "migration-outbox@example.com", first_name: "Migration", last_name: "Synthetic", role: :admin)
    migration.migrate(:down)
    Announcement.reset_column_information
    assert_not Announcement.column_names.include?("fanout_requested_at")
    id = Announcement.insert!({ title: "Before", body: "Words", author_id: author.id, audience: 1, status: 1, published_at: Time.current, created_at: Time.current, updated_at: Time.current }).first.fetch("id")

    migration.migrate(:up)
    migration.migrate(:up)
    Announcement.reset_column_information
    existing = Announcement.find(id)
    assert_nil existing.fanout_requested_at
    assert_nil existing.fanout_settled_at
    assert_equal 0, existing.fanout_cursor
    assert_not Announcement.fanout_pending.exists?(id), "updates posted before the outbox are never re-pushed"
    index = ActiveRecord::Base.connection.indexes(:announcements).find { |item| item.name == "index_announcements_on_fanout_pending" }
    assert_equal "((fanout_requested_at IS NOT NULL) AND (fanout_settled_at IS NULL))", index.where
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Announcement.reset_column_information
  end
end
