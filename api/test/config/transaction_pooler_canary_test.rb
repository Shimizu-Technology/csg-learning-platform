require "test_helper"
require "pg"

# Raw clients deliberately cross transaction boundaries; Rails' test transaction
# would pin a backend and hide an accidentally direct/session-mode connection.
class TransactionPoolerCanaryTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "autocommit and prepared statements rotate backends with a pooler-safe Cable adapter" do
    skip "only runs in the transaction pooler CI legs" unless ENV["POOLER_CANARY"] == "1"

    adapter = ENV.fetch("CABLE_ADAPTER") { Rails.application.config_for(:cable, env: "production").fetch(:adapter) }
    assert_not_equal "postgresql", adapter,
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

      if ENV.fetch("EXPECTED_PREPARED_STATEMENTS") == "true"
        probe.prepare("canary_pid", "SELECT pg_backend_pid()")
        prepared_pids = 12.times.map { probe.exec_prepared("canary_pid").getvalue(0, 0) }
        assert_operator prepared_pids.uniq.size, :>, 1, "protocol prepared statements must survive backend rotation"
        probe.close_prepared("canary_pid")
      end
    ensure
      clients.each do |client|
        begin
          client.exec("ROLLBACK") unless client.transaction_status == PG::PQTRANS_IDLE
        ensure
          client.close
        end
      end
    end
  end
end
