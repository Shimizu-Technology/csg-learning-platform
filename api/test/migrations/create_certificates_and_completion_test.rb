require "test_helper"
require Rails.root.join("db/migrate/20261122040000_create_certificates_and_completion").to_s

class CreateCertificatesAndCompletionTest < ActiveSupport::TestCase
  test "certificate table round trips with pooled statement caches cleared" do
    migration = CreateCertificatesAndCompletion.new
    connection = ActiveRecord::Base.connection
    assert_equal 0, Certificate.count

    2.times { migration.migrate(:down) }
    reset_cache
    assert_not connection.table_exists?(:certificates)

    2.times { migration.migrate(:up) }
    reset_cache
    assert_equal 0, Certificate.count
    assert connection.index_exists?(:certificates, :code, unique: true)
    assert connection.index_exists?(:certificates, :enrollment_id, unique: true, where: "(revoked_at IS NULL)")
    actions = connection.foreign_keys(:certificates).to_h { |key| [ key.column, key.on_delete ] }
    assert_equal({ "enrollment_id" => :cascade, "issued_by_id" => :nullify, "revoked_by_id" => :nullify }, actions)
  ensure
    reset_cache
  end

  private

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Certificate.reset_column_information
  end
end
