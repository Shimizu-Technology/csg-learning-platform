require "json"

namespace :cohort do
  desc "Import cohort data (students, submissions, grades) from csg-prework-grader export"
  task import: :environment do
    json_path = ENV.fetch("JSON_PATH", Rails.root.join("..", "scripts", "cohort3_export.json"))

    unless File.exist?(json_path)
      puts "ERROR: JSON file not found at #{json_path}"
      puts ""
      puts "Run this in the csg-prework-grader production Rails console:"
      puts ""
      puts <<~RUBY
        data = {
          cohort: Cohort.find(3).as_json(only: [:id, :name, :start_date, :repository_name, :github_organization_name]),
          students: Cohort.find(3).students.map { |s|
            { id: s.id, first_name: s.first_name, last_name: s.last_name,
              email: s.email, github_username: s.github_username, active: s.active }
          },
          admins: User.all.map { |u|
            { name: u.name, email: u.email, github_username: u.github_username }
          },
          submissions: Submission.joins(:student).where(students: { cohort_id: 3 }).map { |s|
            { exercise_filename: s.exercise&.filename, exercise_title: s.exercise&.title,
              student_email: s.student&.email, text: s.text, grade: s.grade,
              github_code_url: s.github_code_url, num_submissions: s.num_submissions,
              created_at: s.created_at, updated_at: s.updated_at }
          }
        }
        puts data.to_json
      RUBY
      puts ""
      puts "Save the output to: scripts/cohort3_export.json"
      exit 1
    end

    data = JSON.parse(File.read(json_path))
    puts "Loaded export data from #{json_path}"

    cohort_data = data["cohort"]
    students_data = data["students"]
    admins_data = data["admins"]
    submissions_data = data["submissions"]

    # --- Find existing cohort (use first cohort in the curriculum, or create) ---
    curriculum = Curriculum.find_by!(name: "CSG Full-Stack Bootcamp 2026")
    cohort = curriculum.cohorts.first
    if cohort
      puts "Using existing cohort: #{cohort.name} (id: #{cohort.id})"
      cohort.update!(
        github_organization_name: cohort_data["github_organization_name"] || cohort.github_organization_name,
        repository_name: cohort_data["repository_name"] || cohort.repository_name
      )
    else
      cohort = Cohort.create!(
        name: cohort_data["name"],
        curriculum: curriculum,
        start_date: cohort_data["start_date"],
        repository_name: cohort_data["repository_name"] || "prework-exercises",
        github_organization_name: cohort_data["github_organization_name"],
        cohort_type: :full_stack,
        status: :active
      )
      puts "Created cohort: #{cohort.name} (id: #{cohort.id})"
    end

    # --- Import admin users ---
    admins_created = 0
    admins_data&.each do |admin|
      next if admin["email"].blank?
      user = User.find_by("LOWER(email) = ?", admin["email"].downcase)
      if user
        user.update!(role: :admin) unless user.staff?
      else
        name_parts = admin["name"].to_s.split(" ", 2)
        User.create!(
          email: admin["email"].downcase,
          first_name: name_parts[0],
          last_name: name_parts[1],
          github_username: admin["github_username"],
          role: :admin,
          clerk_id: "pending_#{SecureRandom.uuid}"
        )
        admins_created += 1
      end
    end
    puts "Admins: #{admins_created} new admins created"

    # --- Import students ---
    prework_module = curriculum.modules.find_by(name: "Prework")
    students_created = 0
    students_enrolled = 0

    students_data.each do |student|
      next if student["email"].blank?

      # Match by email (case-insensitive) OR by github_username
      user = User.find_by("LOWER(email) = ?", student["email"].downcase)
      user ||= User.find_by("LOWER(github_username) = ?", student["github_username"]&.downcase) if student["github_username"].present?

      if user
        user.update!(
          first_name: student["first_name"].presence || user.first_name,
          last_name: student["last_name"].presence || user.last_name,
          github_username: student["github_username"].presence || user.github_username
        )
        puts "  Matched existing user: #{user.email} (#{user.full_name})"
      else
        user = User.create!(
          email: student["email"].downcase,
          first_name: student["first_name"],
          last_name: student["last_name"],
          github_username: student["github_username"],
          role: :student,
          clerk_id: "pending_#{SecureRandom.uuid}"
        )
        students_created += 1
        puts "  Created new user: #{user.email}"
      end

      enrollment = Enrollment.find_or_create_by!(user: user, cohort: cohort) do |e|
        e.status = student["active"] ? :active : :dropped
        e.enrolled_at = Time.current
      end
      students_enrolled += 1

      if prework_module
        ModuleAssignment.find_or_create_by!(enrollment: enrollment, module_id: prework_module.id) do |ma|
          ma.unlocked = true
          ma.unlock_date_override = cohort.start_date
        end
      end
    end
    puts "Students: #{students_created} created, #{students_enrolled} enrolled"

    # --- Build filename → content_block mapping ---
    content_blocks_by_filename = {}
    if prework_module
      ContentBlock.joins(:lesson)
        .where(lessons: { module_id: prework_module.id })
        .where.not(filename: [ nil, "" ])
        .find_each do |cb|
          content_blocks_by_filename[cb.filename.strip] = cb
        end
    end
    puts "Content block index: #{content_blocks_by_filename.size} blocks mapped by filename"

    # --- Build email/github → user mapping (for student lookup from submissions) ---
    all_users = User.where(role: :student).to_a
    users_by_email = all_users.index_by { |u| u.email.downcase }
    users_by_github = all_users.select { |u| u.github_username.present? }.index_by { |u| u.github_username.downcase }

    # --- Build student email mapping from prework grader export (email → github) ---
    prework_email_to_github = {}
    students_data.each do |s|
      prework_email_to_github[s["email"]&.downcase] = s["github_username"]&.downcase if s["email"].present? && s["github_username"].present?
    end

    # --- Find admin user for graded_by ---
    grader_user = User.find_by(role: :admin) || User.find_by(role: :instructor)

    # --- Grade mapping ---
    known_grades = { "A" => "A", "B" => "B", "C" => "C", "R" => "R" }

    # --- Import submissions ---
    submissions_created = 0
    submissions_updated = 0
    submissions_skipped = 0
    unknown_grades = Hash.new(0)

    ActiveRecord::Base.transaction do
      submissions_data.each do |sub|
        filename = sub["exercise_filename"]&.strip
        email = sub["student_email"]&.downcase

        next unless filename.present? && email.present?

        cb = content_blocks_by_filename[filename]
        unless cb
          submissions_skipped += 1
          next
        end

        # Find user by email, or by github username from the prework grader mapping
        user = users_by_email[email]
        unless user
          github = prework_email_to_github[email]
          user = users_by_github[github] if github
        end
        unless user
          submissions_skipped += 1
          next
        end

        prework_grade = sub["grade"]
        lp_grade = known_grades[prework_grade]

        if prework_grade.present? && lp_grade.nil?
          unknown_grades[prework_grade] += 1
          puts "  WARN: unknown grade '#{prework_grade}' for #{email}/#{filename} — treating as ungraded"
        end

        existing = Submission.find_by(content_block_id: cb.id, user_id: user.id)
        if existing
          # Update with grade info from prework grader if we have one and existing is ungraded
          if lp_grade && existing.grade.nil?
            existing.update!(
              grade: lp_grade,
              graded_by_id: grader_user&.id,
              graded_at: sub["updated_at"],
              feedback: nil
            )
            submissions_updated += 1

            if lp_grade != "R"
              Progress.find_or_create_by!(user_id: user.id, content_block_id: cb.id) do |p|
                p.status = :completed
                p.completed_at = sub["updated_at"]
              end
            end
          elsif lp_grade && existing.grade.present? && existing.grade != lp_grade
            existing.update!(
              grade: lp_grade,
              graded_by_id: grader_user&.id,
              graded_at: sub["updated_at"]
            )
            submissions_updated += 1
          end
        else
          Submission.create!(
            content_block_id: cb.id,
            user_id: user.id,
            text: sub["text"],
            grade: lp_grade,
            graded_by_id: lp_grade ? grader_user&.id : nil,
            graded_at: lp_grade ? sub["updated_at"] : nil,
            github_code_url: sub["github_code_url"],
            num_submissions: sub["num_submissions"].to_i.clamp(1, 999),
            created_at: sub["created_at"],
            updated_at: sub["updated_at"]
          )
          submissions_created += 1

          if lp_grade && lp_grade != "R"
            Progress.find_or_create_by!(user_id: user.id, content_block_id: cb.id) do |p|
              p.status = :completed
              p.completed_at = sub["updated_at"]
            end
          end
        end
      end
    end

    if unknown_grades.any?
      puts ""
      puts "Unknown grades encountered (mapped to nil/ungraded):"
      unknown_grades.each { |grade, count| puts "  '#{grade}' => #{count} occurrence(s)" }
    end

    puts ""
    puts "=== Import Summary ==="
    puts "Submissions: #{submissions_created} created, #{submissions_updated} updated with grades, #{submissions_skipped} skipped"
    puts ""
    puts "Final state:"
    puts "  Cohort: #{cohort.name} (id: #{cohort.id})"
    puts "  Students enrolled: #{cohort.enrollments.active.count}"
    puts "  Total submissions: #{Submission.joins(user: :enrollments).where(enrollments: { cohort_id: cohort.id }).count}"
    graded = Submission.joins(user: :enrollments).where(enrollments: { cohort_id: cohort.id }).where.not(grade: nil)
    puts "  Graded submissions: #{graded.count}"
    puts "  Ungraded submissions: #{Submission.joins(user: :enrollments).where(enrollments: { cohort_id: cohort.id }).where(grade: nil).count}"
    puts ""
    puts "Done!"
  end

  desc "Import github_issue_url values from prework grader export"
  task import_issue_urls: :environment do
    json_path = ENV.fetch("JSON_PATH", Rails.root.join("..", "scripts", "cohort3_issue_urls.json"))

    unless File.exist?(json_path)
      puts "ERROR: JSON file not found at #{json_path}"
      puts ""
      puts "Run this in the csg-prework-grader production Rails console:"
      puts ""
      puts <<~RUBY
        data = Submission.joins(:student).where(students: { cohort_id: 3 })
                         .where.not(github_issue_url: [nil, ""])
                         .map { |s|
          { exercise_filename: s.exercise&.filename,
            student_email: s.student&.email,
            github_issue_url: s.github_issue_url }
        }
        puts data.to_json
      RUBY
      puts ""
      puts "Save the output to: scripts/cohort3_issue_urls.json"
      exit 1
    end

    entries = JSON.parse(File.read(json_path))
    puts "Loaded #{entries.length} issue URL entries"

    updated = 0
    skipped = 0

    entries.each do |entry|
      filename = entry["exercise_filename"]
      email = entry["student_email"]
      issue_url = entry["github_issue_url"]

      next unless filename.present? && email.present? && issue_url.present?

      user = User.where("LOWER(email) = ?", email.downcase).first
      unless user
        puts "  SKIP: user not found for #{email}"
        skipped += 1
        next
      end

      block = ContentBlock.where("LOWER(filename) = ?", filename.downcase).first
      unless block
        puts "  SKIP: content block not found for #{filename}"
        skipped += 1
        next
      end

      submission = Submission.where(user: user, content_block_id: block.id).order(:created_at).last
      if submission
        submission.update!(github_issue_url: issue_url)
        updated += 1
      else
        puts "  SKIP: no submission found for #{email} / #{filename}"
        skipped += 1
      end
    end

    puts ""
    puts "Updated: #{updated}, Skipped: #{skipped}"
    puts "Done!"
  end
end
