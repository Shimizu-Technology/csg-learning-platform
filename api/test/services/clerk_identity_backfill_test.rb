require "test_helper"

class ClerkIdentityBackfillTest < ActiveSupport::TestCase
  setup do
    @environment = ClerkEnvironment.new(name: "development", issuer: "https://dev.clerk.test")
  end

  test "dry run reports eligible users without writing identities" do
    user = User.create!(clerk_id: "dev_subject", email: "backfill@example.com", role: :student)
    User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "backfill-pending@example.com", role: :student)

    results = ClerkIdentityBackfill.new(environment: @environment).call

    assert_equal [ :would_create ], results.map(&:status)
    assert_empty user.clerk_identities
  end

  test "apply is idempotent and includes archived established users" do
    user = User.create!(clerk_id: "dev_archived", email: "backfill-archived@example.com", role: :student, archived_at: Time.current)

    first = ClerkIdentityBackfill.new(environment: @environment, apply: true).call
    second = ClerkIdentityBackfill.new(environment: @environment, apply: true).call

    assert_equal [ :created ], first.map(&:status)
    assert_equal [ :unchanged ], second.map(&:status)
    assert_equal 1, user.clerk_identities.count
  end
end
