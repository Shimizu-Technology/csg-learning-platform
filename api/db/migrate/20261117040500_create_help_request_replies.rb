# Staff replies to a help request (U-4.7). A reply can keep the request open
# or resolve it; help_requests.staff_response keeps the latest reply's text
# for installed clients that read only that field.
class CreateHelpRequestReplies < ActiveRecord::Migration[8.1]
  def change
    reversible { |dir| dir.up { execute "SET LOCAL lock_timeout = '5s'" } }
    create_table :help_request_replies do |t|
      t.references :help_request, null: false, foreign_key: true, index: false
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.text :body, null: false
      t.boolean :resolved_request, null: false, default: false
      t.timestamps
    end
    add_index :help_request_replies, [ :help_request_id, :created_at ], name: "index_help_request_replies_thread"
  end
end
