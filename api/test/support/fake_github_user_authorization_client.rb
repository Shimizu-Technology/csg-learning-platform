class FakeGithubUserAuthorizationClient
  attr_accessor :person, :failure
  attr_reader :calls

  def initialize
    @person = { id: "24680", login: "app-learner" }
    @calls = []
  end

  def authorization_url(state:, code_challenge:)
    @calls << [ :prepare, code_challenge ]
    "http://127.0.0.1:#{ENV.fetch('QA_WEB_PORT', '5173')}/qa/github-authorize?#{URI.encode_www_form(state: state)}"
  end

  def identity(code:, code_verifier:)
    @calls << [ :identity, code, code_verifier ]
    raise failure if failure

    person
  end
end
