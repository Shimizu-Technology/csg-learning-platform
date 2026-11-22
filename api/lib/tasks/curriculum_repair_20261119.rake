namespace :curriculum do
  namespace :repair_20261119 do
    desc "Private source/learner and draft-copy snapshot for reference cleanup"
    task copy_reference_snapshot: :environment do
      ApplicationRecord.transaction(isolation: :repeatable_read) do
        ApplicationRecord.connection.execute("SET TRANSACTION READ ONLY")
        File.open(ENV.fetch("SNAPSHOT_PATH"), File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
          file.write(JSON.pretty_generate(CurriculumRepair20261119.copy_reference_snapshot))
        end
      end
      puts "Draft-copy reference snapshot saved"
    end

    desc "Dry-run draft-copy personal reference cleanup; APPLY=1 requires a fresh exact snapshot"
    task copy_references: :environment do
      CurriculumRepair20261119.new.run_copy_references(apply: ENV["APPLY"] == "1", snapshot_path: ENV["SNAPSHOT_PATH"])
    end

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

    desc "Held link phase: dry-run by default; apply also requires LINK_ACCESS_CONFIRMED=1 and a fresh snapshot"
    task repoint: :environment do
      CurriculumRepair20261119.new.run_repoint(apply: ENV["APPLY"] == "1", snapshot_path: ENV["SNAPSHOT_PATH"], access_confirmed: ENV["LINK_ACCESS_CONFIRMED"] == "1")
    end

    desc "Print full live diff and desired Cohort 4 tree; APPLY=1 requires an unchanged SNAPSHOT_PATH"
    task run: :environment do
      CurriculumRepair20261119.new.run(apply: ENV["APPLY"] == "1", snapshot_path: ENV["SNAPSHOT_PATH"])
    end
  end
end
