require "test_helper"

class FrontendUrlResolverTest < ActiveSupport::TestCase
  test "prefers explicit public frontend url" do
    env = {
      "PUBLIC_FRONTEND_URL" => "https://learn.codeschoolofguam.com",
      "FRONTEND_URL" => "http://localhost:5173,https://staging.codeschoolofguam.com",
      "RAILS_ENV" => "production"
    }

    assert_equal "https://learn.codeschoolofguam.com", FrontendUrlResolver.resolve(env: env)
  end

  test "prefers non-localhost https url in production" do
    env = {
      "FRONTEND_URL" => "http://localhost:5173,http://localhost:5174,https://learn.codeschoolofguam.com",
      "RAILS_ENV" => "production"
    }

    assert_equal "https://learn.codeschoolofguam.com", FrontendUrlResolver.resolve(env: env)
  end

  test "falls back to first configured url outside production" do
    env = {
      "FRONTEND_URL" => "http://localhost:5173,https://learn.codeschoolofguam.com",
      "RAILS_ENV" => "development"
    }

    assert_equal "http://localhost:5173", FrontendUrlResolver.resolve(env: env)
  end

  test "rejects unsafe origins and prevents arbitrary host injection in deep links" do
    unsafe_env = {
      "PUBLIC_FRONTEND_URL" => "javascript:alert(1)",
      "FRONTEND_URL" => "https://user:pass@evil.example,//evil.example,https://learn.example.test",
      "RAILS_ENV" => "production"
    }

    assert_equal "https://learn.example.test", FrontendUrlResolver.resolve(env: unsafe_env)
    assert_equal "https://learn.example.test/lessons/42?cohort_id=7",
      FrontendUrlResolver.safe_deep_link("/lessons/42?cohort_id=7", env: unsafe_env)

    [ "//evil.example/phish", "https://evil.example/phish", "lessons/42", "/lessons/42\r\nHost: evil", "/lessons/42\\evil" ].each do |bad_path|
      assert_raises(ArgumentError, "expected #{bad_path.inspect} to be rejected") do
        FrontendUrlResolver.safe_deep_link(bad_path, env: unsafe_env)
      end
    end
  end
end
