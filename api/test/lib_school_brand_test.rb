require "test_helper"

class SchoolBrandTest < ActiveSupport::TestCase
  test "defaults preserve invitation subject and configured sender byte for byte" do
    assert_equal "Code School of Guam", SchoolBrand.configure({})[:name]
    assert_equal "CSG Learn", SchoolBrand.configure({})[:product_name]
    assert_equal "You're invited to CSG Learn at Code School of Guam", UserInviteEmailService.send(:subject)
    previous = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"
    assert_equal ENV["RESEND_FROM_EMAIL"], SchoolBrand.email_sender
  ensure
    ENV["RESEND_FROM_EMAIL"] = previous
  end

  test "overrides feed email subject and sender through the shared school configuration" do
    school = Rails.application.config.x.school
    original = school.dup
    previous_from = ENV["RESEND_FROM_EMAIL"]
    previous_name = ENV["EMAIL_SENDER_NAME"]
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@example.org>"
    ENV["EMAIL_SENDER_NAME"] = "Example School"
    SchoolBrand.configure("SCHOOL_NAME" => "Example School", "PRODUCT_NAME" => "Example Learn", "EMAIL_SENDER_NAME" => "Example School").each { |key, value| school.public_send("#{key}=", value) }
    assert_equal "You're invited to Example Learn at Example School", UserInviteEmailService.send(:subject)
    assert_equal "Example School <notifications@example.org>", SchoolBrand.email_sender
  ensure
    Rails.application.config.x.school = original
    ENV["RESEND_FROM_EMAIL"] = previous_from
    ENV["EMAIL_SENDER_NAME"] = previous_name
  end

  test "web and mobile push payloads preserve titles and use configured school fallback" do
    original = Rails.application.config.x.school.dup
    original_new = ExpoPushNotificationService.method(:new)
    announcement = Struct.new(:title, :body, :author, :id).new("Office hours moved", "Meet at 5:30 PM.", nil, 123)
    [ "Code School of Guam", "Example School" ].each do |name|
      Rails.application.config.x.school.name = name
      web_payload = nil
      service = WebPushNotificationService.new
      service.define_singleton_method(:deliver_to_notifications) { |_, payload| web_payload = JSON.parse(payload) }
      service.announcement_published(announcement, [])
      assert_equal "Office hours moved", web_payload["title"]
      assert_equal "#{name} · Meet at 5:30 PM.", web_payload["body"]

      mobile_payload = nil
      receiver = Object.new
      receiver.define_singleton_method(:deliver_notifications) { |_, &block| mobile_payload = block.call(nil) }
      ExpoPushNotificationService.define_singleton_method(:new) { receiver }
      ExpoPushNotificationService.announcement_published(announcement, [])
      assert_equal "Office hours moved", mobile_payload[:title]
      assert_equal "#{name} · Meet at 5:30 PM.", mobile_payload[:body]
    end
  ensure
    ExpoPushNotificationService.define_singleton_method(:new, original_new) if original_new
    Rails.application.config.x.school = original
  end

  test "canonical policy links ignore allowed origin order" do
    origins = [ "http://localhost:5173", "https://preview.example.org", "https://learn.codeschoolofguam.com" ]
    [ origins, origins.reverse ].each do |list|
      config = SchoolBrand.configure("FRONTEND_URL" => list.join(","))
      assert_equal "https://learn.codeschoolofguam.com/privacy", "#{config[:app_url]}/privacy"
      assert_equal "#{config[:app_url]}/privacy", CommunityPolicy::PRIVACY_URL
    end
    assert_equal "https://school.example", SchoolBrand.configure("SCHOOL_APP_URL" => " https://school.example/ ")[:app_url]
  end

  test "public URLs reject invalid values and default blanks" do
    %w[SCHOOL_SITE_URL SCHOOL_APP_URL].each do |key|
      assert_equal SchoolBrand.configure({})[key == "SCHOOL_SITE_URL" ? :site_url : :app_url],
        SchoolBrand.configure(key => "  ")[key == "SCHOOL_SITE_URL" ? :site_url : :app_url]
      [ "garbage", "http://example.org", "javascript:alert(1)", "https://example.org/\n/evil" ].each do |value|
        error = assert_raises(ArgumentError) { SchoolBrand.configure(key => value) }
        assert_includes error.message, key
      end
    end
    assert_raises(ArgumentError) { SchoolBrand.configure("SCHOOL_APP_URL" => "https://example.org/path") }
  end

  test "sender overrides quote commas in display names" do
    previous_from = ENV["RESEND_FROM_EMAIL"]
    previous_name = ENV["EMAIL_SENDER_NAME"]
    original = Rails.application.config.x.school.dup
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@example.org>"
    ENV["EMAIL_SENDER_NAME"] = "School, Inc."
    Rails.application.config.x.school.sender_name = "School, Inc."
    sender = SchoolBrand.email_sender
    assert_equal '"School, Inc." <notifications@example.org>', sender
    assert_equal "School, Inc.", Mail::Address.new(sender).display_name
    assert_nil SchoolBrand.configure("SCHOOL_NAME" => "Example")[:sender_name]
  ensure
    ENV["RESEND_FROM_EMAIL"] = previous_from
    ENV["EMAIL_SENDER_NAME"] = previous_name
    Rails.application.config.x.school = original
  end

  test "application brand literals only live in configuration" do
    # Curriculum descriptions are persisted course data, not application branding.
    offenders = Dir[Rails.root.join("{app,lib,config}/**/*.{rb,erb,rake}")].reject { |path| path.end_with?("lib/school_brand.rb", "lib/tasks/curriculum.rake") }.select do |path|
      File.readlines(path).reject { |line| line.lstrip.start_with?("#") }.join.match?(/\bCode School\b|CSG Learn|codeschoolofguam\.com|codeschoolofguam@gmail\.com/)
    end
    assert_empty offenders
  end
end
