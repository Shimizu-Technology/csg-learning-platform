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
end
