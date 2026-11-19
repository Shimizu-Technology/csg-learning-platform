namespace :curriculum do
  namespace :repair_20261119 do
    desc "Read-only snapshot of audited curriculum and affected learner/plan records (private JSON)"
    task snapshot: :environment do
      path = ENV.fetch("SNAPSHOT_PATH")
      ApplicationRecord.transaction(isolation: :repeatable_read) do
        ApplicationRecord.connection.execute("SET TRANSACTION READ ONLY")
        File.open(path, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
          file.write(JSON.pretty_generate(CurriculumRepair20261119.snapshot))
        end
      end
      puts "Snapshot saved to #{path}"
    end

    desc "Print full live diff and desired Cohort 4 tree; APPLY=1 requires an unchanged SNAPSHOT_PATH"
    task run: :environment do
      CurriculumRepair20261119.new.run(apply: ENV["APPLY"] == "1", snapshot_path: ENV["SNAPSHOT_PATH"])
    end
  end
end
