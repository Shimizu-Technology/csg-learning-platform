require "test_helper"
require Rails.root.join("db/migrate/20261118130000_create_authoring_clones").to_s

class CreateAuthoringClonesTest < ActiveSupport::TestCase
  test "receipt migration round trips with actor-scoped uniqueness" do
    migration = CreateAuthoringClones.new
    migration.migrate(:down)
    clear_caches
    refute ActiveRecord::Base.connection.table_exists?(:authoring_clones)
    migration.migrate(:up)
    clear_caches
    assert ActiveRecord::Base.connection.table_exists?(:authoring_clones)
    index = ActiveRecord::Base.connection.indexes(:authoring_clones).find { |item| item.columns == %w[user_id client_request_id] }
    assert index.unique
  ensure
    clear_caches
  end

  private

  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    AuthoringClone.reset_column_information
  end
end
