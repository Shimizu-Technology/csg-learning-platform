require "test_helper"

class ClerkIdentityTest < ActiveSupport::TestCase
  test "a user can have one identity per issuer" do
    user = User.create!(clerk_id: "dev_subject", email: "identity@example.com", role: :student)
    user.clerk_identities.create!(issuer: "https://dev.clerk.test", clerk_user_id: "dev_subject")
    user.clerk_identities.create!(issuer: "https://prod.clerk.test", clerk_user_id: "prod_subject")

    assert_equal 2, user.clerk_identities.count
  end

  test "a Clerk subject cannot belong to two users" do
    first = User.create!(clerk_id: "first_subject", email: "identity-first@example.com", role: :student)
    second = User.create!(clerk_id: "second_subject", email: "identity-second@example.com", role: :student)
    first.clerk_identities.create!(issuer: "https://prod.clerk.test", clerk_user_id: "shared_subject")

    duplicate = second.clerk_identities.build(issuer: "https://prod.clerk.test", clerk_user_id: "shared_subject")
    assert_not duplicate.valid?
  end
end
