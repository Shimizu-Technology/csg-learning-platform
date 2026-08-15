require "test_helper"

class GithubCheckRunTest < ActiveSupport::TestCase
  test "details links require a complete HTTPS URL" do
    run = GithubCheckRun.new(details_url: "https://github.com/example/project/actions/runs/1")
    run.validate
    assert_empty run.errors[:details_url]

    [ "http://github.com/run", "https://", "https:// github.com/run" ].each do |value|
      run.details_url = value
      run.validate
      assert_includes run.errors[:details_url], "must use HTTPS"
    end
  end
end
