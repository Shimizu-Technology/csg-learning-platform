require "test_helper"
require Rails.root.join("db/migrate/20261118080000_refine_authoring_clone_receipts").to_s

class RefineAuthoringCloneReceiptsTest < ActiveSupport::TestCase
  test "definition provenance and redundant index round trip with pooled caches cleared" do
    migration = RefineAuthoringCloneReceipts.new
    migration.migrate(:down)
    clear_caches
    assert ActiveRecord::Base.connection.index_exists?(:authoring_clones, :user_id)
    refute AuthoringClone.column_names.include?("definition_map")
    migration.migrate(:up)
    clear_caches
    refute ActiveRecord::Base.connection.indexes(:authoring_clones).any? { |index| index.columns == [ "user_id" ] }
    assert AuthoringClone.column_names.include?("definition_map")
    assert ActiveRecord::Base.connection.index_exists?(:authoring_clones, [ :user_id, :client_request_id ], unique: true)
  ensure
    clear_caches
  end

  private

  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    AuthoringClone.reset_column_information
  end
end
