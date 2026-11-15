require "test_helper"

class RateLimitProbeController < ApplicationController
  attr_accessor :probe_path, :probe_action, :probe_user
  def controller_path = probe_path
  def action_name = probe_action
  before_action -> { @current_user = probe_user }
  include AuthenticatedRateLimits
  def index
    render json: { ok: true }
  end
end

class ApiRateLimitsTest < ActionController::TestCase
  tests RateLimitProbeController
  setup do
    ApiRateLimits::STORE.clear
    @controller.probe_path = "api/v1/notifications"
    @controller.probe_action = "index"
    @controller.probe_user = Struct.new(:id).new(101)
    @routes = ActionDispatch::Routing::RouteSet.new
    @routes.draw { get "/probe", to: "rate_limit_probe#index" }
  end
  teardown { ApiRateLimits::STORE.clear }

  {
    all: [ "notifications", "index" ], messages: [ "messages", "create_direct" ],
    help: [ "help_requests", "create" ], uploads: [ "content_blocks", "generic_video_presign" ],
    enrollment: [ "users", "create" ], checkout: [ "course_checkouts", "create" ],
    search: [ "messages_search", "index" ]
  }.each do |name, (controller, action)|
    test "#{name} triggers at N+1 per user and resets" do
      policy = ApiRateLimits::AUTHENTICATED.fetch(name)
      @controller.probe_path = "api/v1/#{controller}"
      @controller.probe_action = action
      policy[:to].times { get :index; assert_response :success }
      get :index
      assert_response :too_many_requests
      assert_equal({ "error" => "Too many requests", "retry_after" => policy[:within].to_i }, response.parsed_body)
      assert_equal policy[:within].to_i.to_s, response.headers["Retry-After"]
      @controller.probe_user = Struct.new(:id).new(202)
      get :index
      assert_response :success
      @controller.probe_user = Struct.new(:id).new(101)
      travel policy[:within] + 1.second do
        get :index
        assert_response :success
      end
    end
  end

  { bootstrap: "sessions", catalog: "course_offerings" }.each do |name, controller|
    test "#{name} keys by forwarded client IP and resets" do
      @controller.probe_user = nil
      @controller.probe_path = "api/v1/#{controller}"
      @request.env["REMOTE_ADDR"] = "10.0.0.2"
      @request.env["HTTP_X_FORWARDED_FOR"] = "198.51.100.10, 10.0.0.1"
      policy = ApiRateLimits::PUBLIC.fetch(name)
      policy[:to].times { get :index; assert_response :success }
      get :index
      assert_response :too_many_requests
      @request.env["HTTP_X_FORWARDED_FOR"] = "198.51.100.11, 10.0.0.1"
      get :index
      assert_response :success
      travel policy[:within] + 1.second do
        @request.env["HTTP_X_FORWARDED_FOR"] = "198.51.100.10, 10.0.0.1"
        get :index
        assert_response :success
      end
    end
  end

  test "public bucket kill switch disables both buckets and preserves authenticated limits" do
    previous = ENV["RATE_LIMIT_PUBLIC_BUCKETS"]
    ENV["RATE_LIMIT_PUBLIC_BUCKETS"] = "off"
    { bootstrap: "sessions", catalog: "course_offerings" }.each do |name, controller|
      @controller.probe_user = nil
      @controller.probe_path = "api/v1/#{controller}"
      key = "rate-limit:public-api:#{name}:#{@request.remote_ip}"
      ApiRateLimits::STORE.write(key, ApiRateLimits::PUBLIC.fetch(name)[:to], expires_in: 1.minute)
      get :index
      assert_response :success
      assert_equal ApiRateLimits::PUBLIC.fetch(name)[:to], ApiRateLimits::STORE.read(key)
    end
    @controller.probe_user = Struct.new(:id).new(101)
    @controller.probe_path = "api/v1/notifications"
    ApiRateLimits::STORE.write("rate-limit:authenticated-api:all:101", 1200, expires_in: 1.minute)
    get :index
    assert_response :too_many_requests
  ensure
    ENV["RATE_LIMIT_PUBLIC_BUCKETS"] = previous
  end

  test "every authenticated limiter callback follows identity authentication" do
    Rails.application.eager_load!
    controllers = ApplicationController.descendants.select { |controller| controller.ancestors.include?(AuthenticatedRateLimits) }
    # The synthetic probe has its own test-only identity callback.
    controllers.reject! { |controller| controller == RateLimitProbeController }
    assert_includes controllers, Api::V1::AgentPostingTokensController
    controllers.each do |controller|
      callbacks = controller._process_action_callbacks.select { |callback| callback.kind == :before }.map(&:filter)
      authentication = callbacks.index do |filter|
        filter.in?([ :authenticate_user!, :require_admin!, :require_staff!, :require_student!, :authenticate_agent_token! ])
      end
      assert authentication, "#{controller.name} must authenticate"
      # Rails captures the limiter scope in its callback closure. Inspect the
      # actual callback chain, including require_admin!-first controllers.
      limiters = callbacks.each_index.select do |index|
        filter = callbacks[index]
        filter.is_a?(Proc) && filter.binding.local_variable_defined?(:scope) &&
          filter.binding.local_variable_get(:scope) == "authenticated-api"
      end
      assert_equal ApiRateLimits::AUTHENTICATED.size, limiters.size, controller.name
      limiters.each { |index| assert_operator index, :>, authentication, controller.name }
    end
  end

  test "catch-all allowance spans controllers" do
    ApiRateLimits::STORE.write("rate-limit:authenticated-api:all:101", 1200, expires_in: 1.minute)
    @controller.probe_path = "api/v1/profile"
    get :index
    assert_response :too_many_requests
    @controller.probe_path = "api/v1/submissions"
    get :index
    assert_response :too_many_requests
  end

  test "webhooks have no general limit" do
    @controller.probe_path = "api/v1/course_checkout_webhooks"
    @controller.probe_user = nil
    3001.times { get :index; assert_response :success }
    assert_not Api::V1::CourseCheckoutWebhooksController.ancestors.include?(AuthenticatedRateLimits)
  end

  test "heavy student session and sixty submissions never hit a limit" do
    start = Time.current
    180.times do |tick|
      travel_to start + tick * 10.seconds do
        paths = [ [ "content_blocks", "video_progress" ] ] * 3
        paths += [ [ "notifications", "index" ], [ "channels", "show" ], [ "presence", "create" ] ] * 3 if tick % 3 == 0
        paths += [ [ "lessons", "show" ] ] * 6
        paths += [ [ "submissions", "grade" ], [ "submissions", "show" ], [ "cohort_grading", "show" ] ] if tick < 60
        paths.each do |controller, action|
          @controller.probe_path = "api/v1/#{controller}"
          @controller.probe_action = action
          get :index
          assert_response :success
        end
      end
    end
  end

  test "every Clerk controller installs limits" do
    Rails.application.eager_load!
    ApplicationController.descendants.each do |controller|
      next unless controller._process_action_callbacks.map(&:filter).include?(:authenticate_user!)
      assert_includes controller.ancestors, AuthenticatedRateLimits, controller.name
    end
  end
end
