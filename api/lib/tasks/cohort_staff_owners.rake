namespace :cohort_staff_owners do
  desc "Report interventions and recovery plans whose owners no longer have cohort access (read-only)"
  task audit: :environment do
    puts "record_type,record_id,cohort_id,owner_id"
    [ Intervention, RecoveryPlan ].each do |model|
      model.includes(:owner, enrollment: :cohort).find_each do |record|
        next if record.owner_valid?

        puts [ model.name, record.id, record.enrollment.cohort_id, record.owner_id ].join(",")
      end
    end
  end
end
