require "test_helper"

class GithubOrganizationAccessServiceTest < ActiveSupport::TestCase
  Response = Struct.new(:code, :parsed_response)
  Person = Struct.new(:id, :email, :github_username)

  test "current membership outranks invitations and invitation lookup paginates" do
    users = [
      Person.new(1, "member@example.com", "Member"),
      Person.new(2, "pending@example.com", "Pending"),
      Person.new(3, "email@example.com", nil),
      Person.new(4, "other@example.com", "Other")
    ]
    requests = []
    getter = lambda do |url, options|
      requests << [ url, options.dig(:query, :page), options.dig(:headers, "Authorization") ]
      if url.include?("/user/memberships/orgs/")
        Response.new(200, { "state" => "active", "role" => "admin" })
      elsif url.end_with?("/members")
        Response.new(200, [ { "login" => "MEMBER" } ])
      elsif options.dig(:query, :page) == 1
        Response.new(200, Array.new(98) { { "login" => "unrelated" } } + [
          { "login" => "member" }, { "login" => "pending" }
        ])
      else
        Response.new(200, [ { "email" => "EMAIL@example.com" } ])
      end
    end

    client = Object.new
    client.define_singleton_method(:get, &getter)
    statuses = GithubOrganizationAccessService.new(organization: "code-school-of-guam", token: "secret", client: client).status_for(users)
    assert_equal({ 1 => "member", 2 => "invited", 3 => "invited", 4 => "not_invited" }, statuses)
    assert_includes requests, [ "https://api.github.com/orgs/code-school-of-guam/invitations", 2, "Bearer secret" ]
  end

  test "provider failures are unavailable rather than a false not invited result" do
    client = Object.new
    client.define_singleton_method(:get) { |*, **| Response.new(403, { "message" => "rate limited" }) }
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "example-org", token: "secret", client: client).status_for([ Person.new(1, "one@example.com", "one") ])
    end
  end

  test "a credential without active organization membership cannot claim a negative status" do
    client = Object.new
    client.define_singleton_method(:get) { |*, **| Response.new(200, { "state" => "pending" }) }
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "example-org", token: "secret", client: client).status_for([ Person.new(1, "one@example.com", "one") ])
    end
  end

  test "exactly twenty full pages are complete when the following page is empty" do
    requests = []
    client = Object.new
    client.define_singleton_method(:get) do |url, options|
      requests << [ url, options.dig(:query, :page) ]
      if url.include?("/user/memberships/orgs/")
        Response.new(200, { "state" => "active" })
      elsif options.dig(:query, :page) <= 20
        Response.new(200, Array.new(100) { |index| { "login" => "member-#{options.dig(:query, :page)}-#{index}" } })
      else
        Response.new(200, [])
      end
    end
    user = Person.new(1, "one@example.com", "member-20-99")
    statuses = GithubOrganizationAccessService.new(organization: "example-org", token: "secret", client: client).status_for([ user ])
    assert_equal "member", statuses.fetch(1)
    assert_includes requests, [ "https://api.github.com/orgs/example-org/members", 21 ]
  end

  test "the entire lookup has a deadline" do
    calls = 0
    client = Object.new
    client.define_singleton_method(:get) do |*, **|
      calls += 1
      Response.new(200, { "state" => "active" })
    end
    times = [ 0, 1, 21 ]
    clock = -> { times.shift || 21 }
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "example-org", token: "secret", client: client, clock: clock).status_for([ Person.new(1, "one@example.com", "one") ])
    end
    assert_equal 1, calls
  end

  test "missing configuration avoids a provider request" do
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "", token: "secret").status_for([])
    end
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "valid-org", token: "").status_for([])
    end
  end
end
