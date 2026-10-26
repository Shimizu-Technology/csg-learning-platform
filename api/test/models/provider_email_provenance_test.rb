require "test_helper"

class ProviderEmailProvenanceTest < ActiveSupport::TestCase
  setup do
    @original_enabled = ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"]
    curriculum = Curriculum.create!(name: "Staged email rollout")
    cohort = Cohort.create!(curriculum: curriculum, name: "Staged email rollout", start_date: Date.current, status: :active)
    @channel = cohort.channels.find_by!(name: "Class Chat")
    @author = User.create!(clerk_id: "provenance_author", email: "provenance-author@example.com", role: :student)
  end

  teardown do
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = @original_enabled
  end

  test "first compatibility release creates untagged identities unless explicitly activated" do
    [ nil, "false", "1", "TRUE", "" ].each do |setting|
      ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = setting
      message, notification = create_send_records
      [ message, notification ].each do |record|
        assert_nil record.reload.email_application
        assert_equal({}, record.provider_application_tags)
      end
    end
  end

  test "activation changes only new identities and readers honor markers when disabled" do
    ENV.delete("EMAIL_APPLICATION_PROVENANCE_ENABLED")
    legacy = create_send_records
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = "true"
    tagged = create_send_records
    legacy.each do |record|
      assert_nil record.reload.email_application
      assert_equal({}, record.provider_application_tags)
    end
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = "false"
    tagged.each do |record|
      assert_equal "csg_learn", record.reload.email_application
      assert_equal({ tags: [ { name: "application", value: "csg_learn" } ] }, record.provider_application_tags)
    end
    create_send_records.each { |record| assert_nil record.reload.email_application }
  end

  private

  def create_send_records
    message = Message.create!(channel: @channel, author: @author, body: "Staged rollout")
    notification = Notification.create!(user: @author, actor: @author, notifiable: message,
      notification_type: :message, title: "Staged rollout", path: "/messages/#{@channel.id}")
    [ message, notification ]
  end
end
