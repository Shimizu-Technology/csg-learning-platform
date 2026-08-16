require "test_helper"

class ClerkEnvironmentTest < ActiveSupport::TestCase
  test "supports development and production issuers without duplicating legacy config" do
    with_clerk_env(
      "CLERK_ISSUER" => "https://dev.clerk.test/",
      "CLERK_SECRET_KEY" => "sk_test_legacy",
      "CLERK_DEVELOPMENT_ISSUER" => "https://dev.clerk.test",
      "CLERK_DEVELOPMENT_SECRET_KEY" => "sk_test_explicit",
      "CLERK_PRODUCTION_ISSUER" => "https://prod.clerk.test",
      "CLERK_PRODUCTION_SECRET_KEY" => "sk_live_test",
      "CLERK_PRIMARY_ENVIRONMENT" => "production"
    ) do
      assert_equal %w[development production], ClerkEnvironment.all.map(&:name)
      assert_equal "production", ClerkEnvironment.primary.name
      assert_equal "sk_test_explicit", ClerkEnvironment.for_issuer("https://dev.clerk.test/").secret_key
    end
  end

  test "keeps the single issuer variables backwards compatible" do
    with_clerk_env(
      "CLERK_ISSUER" => "https://legacy.clerk.test",
      "CLERK_SECRET_KEY" => "sk_test_legacy",
      "CLERK_DEVELOPMENT_ISSUER" => nil,
      "CLERK_PRODUCTION_ISSUER" => nil,
      "CLERK_PRIMARY_ENVIRONMENT" => nil
    ) do
      assert_equal "legacy", ClerkEnvironment.primary.name
      assert_equal "sk_test_legacy", ClerkEnvironment.primary.secret_key
    end
  end

  test "fails closed when an explicitly selected primary environment is missing" do
    with_clerk_env(
      "CLERK_ISSUER" => "https://legacy.clerk.test",
      "CLERK_DEVELOPMENT_ISSUER" => nil,
      "CLERK_PRODUCTION_ISSUER" => nil,
      "CLERK_PRIMARY_ENVIRONMENT" => "production"
    ) do
      assert_nil ClerkEnvironment.primary
    end
  end

  test "keeps development primary until the cutover is explicitly selected" do
    with_clerk_env(
      "CLERK_ISSUER" => nil,
      "CLERK_DEVELOPMENT_ISSUER" => "https://dev.clerk.test",
      "CLERK_PRODUCTION_ISSUER" => "https://prod.clerk.test",
      "CLERK_PRIMARY_ENVIRONMENT" => nil
    ) do
      assert_equal "development", ClerkEnvironment.primary.name
    end
  end

  private

  def with_clerk_env(values)
    original = values.to_h { |key, _value| [ key, ENV[key] ] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    original.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
