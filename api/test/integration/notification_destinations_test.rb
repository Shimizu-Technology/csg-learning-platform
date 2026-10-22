require "test_helper"

class NotificationDestinationsTest < ActionDispatch::IntegrationTest
  test "notification JSON obeys the shared installed and current client wire contract" do
    user = User.create!(clerk_id: "wire_contract_student", email: "wire-contract@example.test", role: :student)
    contract = JSON.parse(File.read(Rails.root.join("../mobile/src/lib/fixtures/notification-wire-contract.json")))
    ids = contract.each_with_index.map do |entry, ids_offset|
      source = User.create!(clerk_id: "wire_source_#{ids_offset}", email: "wire-source-#{ids_offset}@example.test", role: :student)
      user.notifications.create!(notifiable: source, notification_type: :system, title: "Destination contract", path: entry.fetch("source_path")).id
    end
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    get "/api/v1/notifications", headers: { "Authorization" => "Bearer test" }
    assert_response :success
    notifications = response.parsed_body.fetch("notifications").index_by { |entry| entry.fetch("id") }
    contract.zip(ids).each do |entry, id|
      assert_equal entry.fetch("path"), notifications.fetch(id).fetch("path")
      assert_equal entry.fetch("destination_path"), notifications.fetch(id).fetch("destination_path")
    end
  ensure
    ClerkAuth.define_singleton_method(:verify, original) if original
  end
end
