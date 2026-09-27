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
      if url.end_with?("/members")
        Response.new(200, [ { "login" => "MEMBER" } ])
      elsif options.dig(:query, :page) == 1
        Response.new(200, Array.new(98) { { "invitee" => { "login" => "unrelated" } } } + [
          { "invitee" => { "login" => "member" } }, { "invitee" => { "login" => "pending" } }
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

  test "missing configuration avoids a provider request" do
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "", token: "secret").status_for([])
    end
    assert_raises(GithubOrganizationAccessService::Unavailable) do
      GithubOrganizationAccessService.new(organization: "valid-org", token: "").status_for([])
    end
  end
end
