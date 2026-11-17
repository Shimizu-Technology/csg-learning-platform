require "test_helper"
require "pg"

# Raw clients deliberately cross transaction boundaries; Rails' test transaction
# would pin a backend and hide an accidentally direct/session-mode connection.
class TransactionPoolerCanaryTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "autocommit rotates backends and session notifications cannot be relied on" do
    skip "only runs in the transaction pooler CI legs" unless ENV["POOLER_CANARY"] == "1"

    assert_not_equal "postgresql", Rails.application.config_for(:cable, env: "production").fetch(:adapter),
      "production broadcasts must not depend on LISTEN/NOTIFY through the pooler"

    clients = []
    begin
      6.times do
        client = PG.connect(ENV.fetch("DATABASE_URL").sub(/\?.*\z/, ""))
        clients << client
        client.exec("BEGIN")
        client.exec("SELECT pg_backend_pid()")
      end
      clients.each { |client| client.exec("COMMIT") }
      probe = clients.first
      pids = 12.times.map { probe.exec("SELECT pg_backend_pid()").getvalue(0, 0) }
      assert_operator pids.uniq.size, :>, 1, "autocommit must cross backends; a direct/session connection is not a pooler test"

      channel = "csg_canary_#{Process.pid}"
      probe.exec("LISTEN #{channel}")
      # Each transaction pins one of the six backends, including the listener.
      clients.each { |client| client.exec("BEGIN"); client.exec("SELECT pg_backend_pid()") }
      listening = clients.select { |client| client.exec("SELECT pg_listening_channels()").values.flatten.include?(channel) }
      assert_equal 1, listening.size
      receiver = (clients - listening).first
      listening.first.exec("SELECT pg_notify('#{channel}', 'canary')")
      listening.first.exec("COMMIT")
      assert_nil receiver.wait_for_notify(0.05), "notifications must not be treated as transaction-safe"
      assert_equal channel, listening.first.wait_for_notify(1)&.to_s
    ensure
      clients.each do |client|
        client.exec("ROLLBACK") if client.transaction_status == PG::PQTRANS_INTRANS
      end
      # Pin every backend again before removing session state. An autocommit
      # UNLISTEN could otherwise clean a different backend from the listener.
      clients.each { |client| client.exec("BEGIN"); client.exec("SELECT 1") }
      clients.each do |client|
        client.exec("UNLISTEN *")
        client.exec("COMMIT")
        client.close
      end
    end
  end
end
