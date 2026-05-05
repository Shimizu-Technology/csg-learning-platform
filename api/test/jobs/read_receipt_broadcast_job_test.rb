require "test_helper"

class ReadReceiptBroadcastJobTest < ActiveJob::TestCase
  test "broadcasts only newly read messages authored by other users" do
    curriculum = Curriculum.create!(name: "Bootcamp 2028")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 5", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    reader = User.create!(clerk_id: "receipt_reader", email: "receipt-reader@example.com", first_name: "Receipt", last_name: "Reader", role: :student)
    author = User.create!(clerk_id: "receipt_author", email: "receipt-author@example.com", first_name: "Receipt", last_name: "Author", role: :admin)
    Enrollment.create!(user: reader, cohort: cohort, status: :active)

    old_message = Message.create!(channel: channel, author: author, body: "Already read", created_at: 2.hours.ago)
    new_message = Message.create!(channel: channel, author: author, body: "Newly read", created_at: 1.minute.ago)
    own_message = Message.create!(channel: channel, author: reader, body: "My own message", created_at: Time.current)
    previous_last_read_at = 30.minutes.ago

    broadcasted = []
    original_updated = MessageBroadcastService.method(:updated)
    MessageBroadcastService.define_singleton_method(:updated) { |message| broadcasted << message }

    ReadReceiptBroadcastJob.perform_now(channel, reader.id, previous_last_read_at)

    assert_equal [ new_message ], broadcasted
    assert_not_includes broadcasted, old_message
    assert_not_includes broadcasted, own_message
  ensure
    MessageBroadcastService.define_singleton_method(:updated, original_updated) if defined?(original_updated) && original_updated
  end
end
