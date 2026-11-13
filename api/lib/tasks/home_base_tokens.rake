namespace :home_base do
  namespace :tokens do
    desc "Issue a digest-only token for an accepted admin (prints the secret once)"
    task :create, [ :user_id ] => :environment do |_task, args|
      user = User.find(Integer(args.fetch(:user_id)))
      record, plaintext = HomeBaseToken.issue!(user: user)
      warn "Created home-base token ID #{record.id}; save the following secret securely now."
      puts plaintext
    end

    desc "Revoke a digest-only token by its record ID"
    task :revoke, [ :id ] => :environment do |_task, args|
      HomeBaseToken.find(Integer(args.fetch(:id))).revoke!
      puts "Revoked home-base token."
    end
  end
end
