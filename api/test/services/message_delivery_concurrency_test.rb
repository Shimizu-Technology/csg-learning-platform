require "test_helper"

class MessageDeliveryConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  def setup
    @curriculum = Curriculum.create!(name: "Concurrent delivery curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Concurrent delivery cohort", start_date: Date.current, status: :active)
    @author = User.create!(clerk_id: "concurrent_delivery_author", email: "concurrent-delivery-author@example.com", first_name: "Concurrent", last_name: "Author", role: :student)
    @recipient = User.create!(clerk_id: "concurrent_delivery_recipient", email: "concurrent-delivery-recipient@example.com", first_name: "Concurrent", last_name: "Recipient", role: :student)
    Enrollment.create!(user: @author, cohort: @cohort, status: :active)
    Enrollment.create!(user: @recipient, cohort: @cohort, status: :active)
  end

  def teardown
    begin
      @cohort&.destroy!
      @curriculum&.destroy!
    ensure
      User.where(clerk_id: %w[concurrent_delivery_author concurrent_delivery_recipient]).destroy_all
    end
  end

  test "concurrent retries serialize created and thread broadcasts" do
    channel = @cohort.channels.find_by!(name: "Class Chat")
    root = Message.create!(channel: channel, author: @author, body: "Root")
    reply = Message.create!(channel: channel, author: @author, parent_message: root, body: "Reply")

    original_notifications = NotificationDeliveryService.method(:message_created)
    notification_calls = 0
    count_lock = Mutex.new
    NotificationDeliveryService.define_singleton_method(:message_created) do |_message, push: false|
      count_lock.synchronize { notification_calls += 1 }
      sleep 0.02
      []
    end

    original_broadcast = UserMessagesChannel.method(:broadcast_to)
    broadcasts = Hash.new(0)
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, payload|
      key = [ payload.fetch(:event), payload.fetch(:message).fetch(:id), user.id ]
      count_lock.synchronize { broadcasts[key] += 1 }
      sleep 0.02
    end

    ready = Queue.new
    release = Queue.new
    errors = Queue.new
    threads = 2.times.map do
      Thread.new do
        begin
          ActiveRecord::Base.connection_pool.with_connection do
            ready << true
            release.pop
            MessageDeliveryService.created(Message.find(reply.id))
          end
        rescue StandardError => e
          errors << e
        end
      end
    end
    2.times { ready.pop }
    2.times { release << true }
    threads.each { |thread| assert thread.join(5), "concurrent delivery did not finish" }

    collected_errors = []
    collected_errors << errors.pop(true) until errors.empty?
    assert_empty collected_errors, collected_errors.map(&:message).join("; ")
    assert_equal 1, notification_calls
    [ @author.id, @recipient.id ].each do |user_id|
      assert_equal 1, broadcasts[[ "created", reply.id, user_id ]]
      assert_equal 1, broadcasts[[ "updated", root.id, user_id ]]
    end
    reply.reload
    assert reply.broadcasts_delivered_at?
    assert reply.thread_broadcasts_delivered_at?
    assert_empty reply.delivered_recipient_ids(:broadcast_recipient_ids)
    assert_empty reply.delivered_recipient_ids(:thread_broadcast_recipient_ids)
  ensure
    threads&.each { |thread| thread.kill if thread.alive? }
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    NotificationDeliveryService.define_singleton_method(:message_created, original_notifications) if defined?(original_notifications) && original_notifications
  end

  test "broadcast stages independently serialize concurrent retries after notification delivery" do
    channel = @cohort.channels.find_by!(name: "Class Chat")
    root = Message.create!(channel: channel, author: @author, body: "Root")
    reply = Message.create!(
      channel: channel,
      author: @author,
      parent_message: root,
      body: "Reply",
      notifications_delivered_at: Time.current
    )

    original_broadcast = UserMessagesChannel.method(:broadcast_to)
    count_lock = Mutex.new
    broadcasts = Hash.new(0)
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, payload|
      key = [ payload.fetch(:event), payload.fetch(:message).fetch(:id), user.id ]
      count_lock.synchronize { broadcasts[key] += 1 }
      sleep 0.02
    end

    all_threads = []
    [ :deliver_message_broadcast, :deliver_thread_broadcast ].each do |stage|
      ready = Queue.new
      release = Queue.new
      errors = Queue.new
      threads = 2.times.map do
        Thread.new do
          begin
            ActiveRecord::Base.connection_pool.with_connection do
              ready << true
              release.pop
              MessageDeliveryService.send(stage, Message.find(reply.id))
            end
          rescue StandardError => e
            errors << e
          end
        end
      end
      all_threads.concat(threads)
      2.times { ready.pop }
      2.times { release << true }
      threads.each { |thread| assert thread.join(5), "concurrent #{stage} did not finish" }
      collected_errors = []
      collected_errors << errors.pop(true) until errors.empty?
      assert_empty collected_errors, collected_errors.map(&:message).join("; ")
    end

    [ @author.id, @recipient.id ].each do |user_id|
      assert_equal 1, broadcasts[[ "created", reply.id, user_id ]]
      assert_equal 1, broadcasts[[ "updated", root.id, user_id ]]
    end
    reply.reload
    assert reply.broadcasts_delivered_at?
    assert reply.thread_broadcasts_delivered_at?
  ensure
    all_threads&.each { |thread| thread.kill if thread.alive? }
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
  end

  test "deletion waits for an active broadcast critical section" do
    message = Message.create!(channel: @cohort.channels.find_by!(name: "Class Chat"), author: @author, body: "Ordered delete")
    first_entered = Queue.new
    release_first = Queue.new
    second_entered = Queue.new
    errors = Queue.new

    first = Thread.new do
      MessageDeliveryService.synchronize_delivery(Message.find(message.id)) do
        first_entered << true
        release_first.pop
      end
    rescue StandardError => error
      errors << error
    end
    first_entered.pop
    second = Thread.new do
      MessageDeliveryService.synchronize_delivery(Message.find(message.id)) do
        second_entered << true
      end
    rescue StandardError => error
      errors << error
    end

    assert_raises(ThreadError) { second_entered.pop(true) }
    release_first << true
    assert first.join(5), "active broadcast lock did not release"
    assert second.join(5), "waiting deletion lock did not proceed"
    assert second_entered.pop(true)
    collected_errors = []
    collected_errors << errors.pop(true) until errors.empty?
    assert_empty collected_errors, collected_errors.map(&:message).join("; ")
  ensure
    release_first << true if defined?(release_first) && first&.alive?
    first&.kill if first&.alive?
    second&.kill if second&.alive?
  end
end
