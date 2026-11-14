require "pg"

# Check the running instance, not just the config file or an open TCP port.
PG.connect(host: "127.0.0.1", port: 16432, user: "postgres", dbname: "pgbouncer") do |connection|
  settings = connection.exec("SHOW CONFIG").to_h { |row| [row.fetch("key"), row.fetch("value")] }
  { "pool_mode" => "transaction", "server_round_robin" => "1", "default_pool_size" => "6" }.each do |key, expected|
    abort "#{key}: expected #{expected}, got #{settings[key]}" unless settings[key] == expected
  end
  puts "Verified transaction mode, round robin, and six-backend pool"
end
