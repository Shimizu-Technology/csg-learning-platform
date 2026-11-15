require "test_helper"

# R-5 fix round 1: a subscription authorizes once, so a change to what a user
# may receive must close their open connections. These tests drive a real
# ApplicationCable::Connection (with a stand-in socket) through the in-process
# pubsub, the same path the production async adapter uses.
class CableAccessRevocationTest < ActiveSupport::TestCase
  include ActionCable::TestHelper

  # Records what the server sends and whether it closed the socket.
  class RecordingSocket
    attr_reader :frames

    def initialize
      @frames = Queue.new
      @closed = false
    end

    def protocol = "actioncable-v1-json"
    def possible? = true
    def alive? = !@closed
    def closed? = @closed
    def transmit(data) = (@frames << JSON.parse(data))
    def close(*) = (@closed = true)

    def drain
      list = []
      list << @frames.pop until @frames.empty?
      list
    end
  end

  setup do
    curriculum = Curriculum.create!(name: "Revocation Curriculum")
    @cohort_a = Cohort.create!(curriculum: curriculum, name: "Revocation A", start_date: Date.current, status: :active)
    @cohort_b = Cohort.create!(curriculum: curriculum, name: "Revocation B", start_date: Date.current, status: :active)
    @admin = User.create!(clerk_id: "revocation_admin", email: "revocation-admin@example.com", role: :admin)
    @other_admin = User.create!(clerk_id: "revocation_admin_2", email: "revocation-admin-2@example.com", role: :admin)
    @instructor = User.create!(clerk_id: "revocation_instructor", email: "revocation-instructor@example.com", role: :instructor)
    @cohort_a.cohort_instructor_assignments.create!(user: @instructor)
    @cohort_b.cohort_instructor_assignments.create!(user: @instructor)
    @student = User.create!(clerk_id: "revocation_student", email: "revocation-student@example.com", role: :student)
    Enrollment.create!(user: @student, cohort: @cohort_a, status: :active)
    @connections = []
  end

  teardown do
    @connections.each { |connection| connection.send(:handle_close) unless connection.instance_variable_get(:@closed_in_test) }
    pubsub.clear
  end

  test "removing an instructor's cohort assignment closes the connection and the reconnect drops that stream" do
    connection, socket = open_presence(@instructor)
    assert_includes connection_streams(connection), PresenceChannel.cohort_stream(@cohort_a.id)
    # Control: the harness delivers a heartbeat while access is in place.
    PresenceBroadcastService.user_seen(@student.tap { |student| student.last_seen_at = Time.current })
    wait_until { presence_frames(socket).any? }

    @cohort_a.cohort_instructor_assignments.find_by!(user: @instructor).destroy!

    assert_closed_for_reconnect(socket, reconnect: true)
    close(connection)
    assert_no_presence_after_close(socket)

    _reconnected, fresh_socket = open_presence(@instructor)
    assert_equal [ PresenceChannel.cohort_stream(@cohort_b.id) ], connection_streams(@connections.last)
    broadcast_presence(@student)
    assert_empty presence_frames(fresh_socket), "cohort A heartbeats must not reach the unassigned instructor"
  end

  test "adding a cohort assignment reconnects the instructor so the new cohort streams" do
    loner = User.create!(clerk_id: "revocation_loner", email: "revocation-loner@example.com", role: :instructor)
    connection, socket = open_presence(loner)
    assert_empty connection_streams(connection)

    @cohort_a.cohort_instructor_assignments.create!(user: loner)

    assert_closed_for_reconnect(socket, reconnect: true)
    close(connection)
    reconnected, = open_presence(loner)
    assert_equal [ PresenceChannel.cohort_stream(@cohort_a.id) ], connection_streams(reconnected)
  end

  test "archiving an instructor closes the connection without reconnect and blocks the old token path" do
    connection, socket = open_presence(@instructor)

    @instructor.archive!

    assert_closed_for_reconnect(socket, reconnect: false)
    close(connection)
    assert_no_presence_after_close(socket)

    # Even a token issued before the archive cannot open a new connection.
    _rejected, rejected_socket = open_connection(@instructor)
    frames = rejected_socket.drain
    assert_equal [ { "type" => "disconnect", "reason" => "unauthorized", "reconnect" => false } ], frames
    assert rejected_socket.closed?
  end

  test "demoting an admin with no cohorts closes the admin stream and the reconnect has none" do
    connection, socket = open_presence(@admin)
    assert_equal [ PresenceChannel::ADMIN_STREAM ], connection_streams(connection)

    @admin.update!(role: :instructor)

    assert_closed_for_reconnect(socket, reconnect: true)
    close(connection)
    assert_no_presence_after_close(socket)

    reconnected, fresh_socket = open_presence(@admin)
    assert_empty connection_streams(reconnected)
    broadcast_presence(@student)
    assert_empty presence_frames(fresh_socket), "a demoted admin must not receive every student's heartbeat"
  end

  test "a resubscribe on a still-open connection reads the user again" do
    stale = User.find(@admin.id)
    connection, socket = open_connection(stale)
    User.where(id: @admin.id).update_all(role: User.roles[:instructor]) # skips callbacks: the connection stays open

    subscribe_presence(connection, socket)
    assert_empty connection_streams(connection)
  end

  test "a role change also closes a messages-only connection" do
    connection, socket = open_connection(@student)
    command(connection, "subscribe", "UserMessagesChannel")
    wait_for_confirmation(socket)

    @student.update!(role: :instructor)

    assert_closed_for_reconnect(socket, reconnect: true)
    close(connection)
  end

  test "changes that do not affect access leave connections open" do
    _connection, socket = open_presence(@instructor)

    @instructor.update!(first_name: "Renamed")
    @instructor.record_seen!(now: 5.minutes.from_now)

    wait_for_event_loop
    assert_not socket.closed?
    assert_empty socket.drain.select { |frame| frame["type"] == "disconnect" }
  end

  private

  def pubsub
    ActionCable.server.pubsub
  end

  def open_connection(user)
    env = Rack::MockRequest.env_for("/cable", params: { token: CableToken.issue_for(user) })
    connection = ApplicationCable::Connection.new(ActionCable.server, env)
    socket = RecordingSocket.new
    connection.instance_variable_set(:@websocket, socket)
    connection.send(:handle_open)
    @connections << connection
    wait_for_event_loop
    [ connection, socket ]
  end

  def open_presence(user)
    connection, socket = open_connection(user)
    subscribe_presence(connection, socket)
    [ connection, socket ]
  end

  def subscribe_presence(connection, socket)
    command(connection, "subscribe", "PresenceChannel")
    wait_for_confirmation(socket)
  end

  def command(connection, name, channel)
    connection.send(:handle_channel_command, { "command" => name, "identifier" => { channel: channel }.to_json })
  end

  def connection_streams(connection)
    subscription = connection.subscriptions.send(:subscriptions).values.find { |sub| sub.is_a?(PresenceChannel) }
    subscription.send(:streams).keys
  end

  # Pubsub subscribe and delivery run on the cable event loop. A task posted
  # after them runs after them.
  def wait_for_event_loop
    2.times do
      latch = Queue.new
      ActionCable.server.event_loop.post { latch << true }
      Timeout.timeout(2) { latch.pop }
    end
  end

  def wait_until(timeout: 2)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    until yield
      flunk "timed out waiting" if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
      Thread.pass
    end
  end

  # The confirmation follows the pubsub subscribe, which completes off this thread.
  def wait_for_confirmation(socket)
    seen = []
    wait_until { (seen.concat(socket.drain)).any? { |frame| frame["type"] == "confirm_subscription" } }
  end

  def assert_closed_for_reconnect(socket, reconnect:)
    wait_until { socket.closed? }
    disconnects = socket.drain.select { |frame| frame["type"] == "disconnect" }
    assert_equal [ { "type" => "disconnect", "reason" => "remote", "reconnect" => reconnect } ], disconnects
  end

  # What the WebSocket driver does when the socket finishes closing.
  def close(connection)
    connection.send(:handle_close)
    connection.instance_variable_set(:@closed_in_test, true)
    wait_for_event_loop
  end

  def broadcast_presence(user)
    user.last_seen_at = Time.current
    PresenceBroadcastService.user_seen(user)
    wait_for_event_loop
    sleep 0.05 # worker pool hand-off after the event loop
  end

  def presence_frames(socket)
    socket.drain.select { |frame| frame.dig("message", "event") == "presence.updated" }
  end

  def assert_no_presence_after_close(socket)
    broadcast_presence(@student)
    assert_empty presence_frames(socket)
  end
end
