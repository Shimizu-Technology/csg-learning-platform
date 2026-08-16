namespace :clerk do
  desc "Backfill current users into the configured development/legacy Clerk identity map (dry-run unless APPLY=1)"
  task backfill_identities: :environment do
    environment = ClerkEnvironment.all.find(&:development?) || ClerkEnvironment.for_issuer(ENV["CLERK_ISSUER"])
    abort "No development or legacy Clerk issuer is configured" unless environment

    apply = ENV["APPLY"] == "1"
    results = ClerkIdentityBackfill.new(environment: environment, apply: apply).call
    results.each { |result| puts [ result.status, result.user_id, result.email, result.detail ].compact.join("\t") }
    puts "mode=#{apply ? 'apply' : 'dry-run'} counts=#{results.map(&:status).tally}"
    abort "Identity conflicts detected" if results.any? { |result| result.status == :conflict }
  end

  desc "Create/attach authorized users in Clerk production (dry-run unless APPLY=1; never deletes users)"
  task provision_production_users: :environment do
    environment = ClerkEnvironment.all.find(&:production?)
    abort "CLERK_PRODUCTION_ISSUER and CLERK_PRODUCTION_SECRET_KEY are required" unless environment&.secret_key.present?

    apply = ENV["APPLY"] == "1"
    results = ClerkProductionProvisioner.new(environment: environment, apply: apply).call
    results.each do |result|
      puts [ result.status, result.user_id, result.email, result.clerk_user_id, result.detail ].compact.join("\t")
    end
    puts "mode=#{apply ? 'apply' : 'dry-run'} counts=#{results.map(&:status).tally}"
    abort "Provisioning did not complete cleanly" if results.any? { |result| %i[conflict failed].include?(result.status) }
  end
end
