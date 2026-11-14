namespace :agent_posting do
  namespace :tokens do
    desc "Issue a message-posting token for an accepted admin (prints the secret once)"
    task :create, [ :user_id, :name, :expires_in_days ] => :environment do |_task, args|
      user = User.find(Integer(args.fetch(:user_id)))
      days = args[:expires_in_days].presence
      expires_at = days && Integer(days).days.from_now
      record, plaintext = AgentPostingToken.issue!(user: user, name: args.fetch(:name), expires_at: expires_at)
      warn "Created assistant posting token ID #{record.id} (#{record.name}); save the following secret securely now."
      puts plaintext
    end

    desc "Revoke an assistant posting token by its record ID"
    task :revoke, [ :id ] => :environment do |_task, args|
      AgentPostingToken.find(Integer(args.fetch(:id))).revoke!
      puts "Revoked assistant posting token."
    end
  end
end
