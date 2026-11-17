require "test_helper"

# U-6.8: the shared editor's mode and Enter-to-send choice are stored on the
# account, so they follow a person across browsers and devices.
class EditorPreferencesTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(clerk_id: "editor_prefs_learner", email: "editor-prefs@example.invalid", first_name: "Pref", last_name: "Learner", role: :student)
  end

  def session_preferences
    as_user(@user) { post "/api/v1/sessions", headers: auth_headers }
    assert_response :success
    response.parsed_body.dig("user", "editor_preferences")
  end

  def save(body)
    as_user(@user) { patch "/api/v1/editor_preferences", params: body, headers: auth_headers, as: :json }
  end

  test "a person who never chose has no stored preference, so the client can upload its local choice" do
    assert_equal({ "mode" => nil, "enter_sends" => nil }, session_preferences)
  end

  test "each field saves alone and the session carries it to the next device" do
    session_preferences
    updated_at = @user.reload.updated_at
    save(mode: "markdown")
    assert_response :success
    assert_equal({ "mode" => "markdown", "enter_sends" => nil }, response.parsed_body["editor_preferences"])

    save(enter_sends: false)
    assert_response :success
    assert_equal({ "mode" => "markdown", "enter_sends" => false }, response.parsed_body["editor_preferences"])

    assert_equal({ "mode" => "markdown", "enter_sends" => false }, session_preferences)
    assert_equal updated_at, @user.reload.updated_at, "A preference is not a profile edit"

    save(mode: "rich", enter_sends: true)
    assert_equal({ "mode" => "rich", "enter_sends" => true }, session_preferences)
  end

  test "initialize fills only what the account doesn't have yet and answers with the account's values" do
    save(mode: "markdown", enter_sends: false, initialize: true)
    assert_response :success
    assert_equal({ "mode" => "markdown", "enter_sends" => false }, response.parsed_body["editor_preferences"])

    # Another device chose since: a late legacy upload changes nothing and reports what the account has.
    @user.update_columns(editor_mode: "rich", editor_enter_sends: nil)
    save(mode: "markdown", enter_sends: false, initialize: true)
    assert_response :success
    assert_equal({ "mode" => "rich", "enter_sends" => false }, response.parsed_body["editor_preferences"])
    assert_equal({ "mode" => "rich", "enter_sends" => false }, session_preferences)
  end

  test "a delayed legacy upload never overwrites a choice saved by another device in between" do
    # Device A saw no preference; device B saves Rich; A's one-time upload arrives afterwards.
    save(mode: "rich")
    save(mode: "markdown", initialize: true)
    assert_equal "rich", response.parsed_body.dig("editor_preferences", "mode")
    assert_equal "rich", @user.reload.editor_mode
  end

  test "unknown values and empty requests are refused without changing anything" do
    save(mode: "markdown", enter_sends: false)
    [ { mode: "wysiwyg" }, { mode: "" }, { mode: nil }, { enter_sends: "false" }, { enter_sends: nil }, {}, { mode: "rich", enter_sends: "yes" }, { mode: "rich", initialize: "true" }, { initialize: true } ].each do |body|
      save(body)
      assert_response :unprocessable_entity, body.inspect
    end
    assert_equal({ "mode" => "markdown", "enter_sends" => false }, session_preferences)
  end

  test "the database refuses an unknown mode" do
    assert_raises(ActiveRecord::StatementInvalid) { User.transaction(requires_new: true) { @user.update_column(:editor_mode, "wysiwyg") } }
    refute @user.reload.tap { |user| user.editor_mode = "wysiwyg" }.valid?
  end

  test "signing in is required" do
    patch "/api/v1/editor_preferences", params: { mode: "markdown" }, as: :json
    assert_response :unauthorized
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
