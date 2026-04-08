puts "Seeding database..."

# Pre-create admin user — placeholder clerk_id gets replaced on first Clerk sign-in (matched by email)
admin = User.find_or_initialize_by(email: "codeschoolofguam@gmail.com")
admin.assign_attributes(clerk_id: admin.clerk_id.presence || "pending_#{SecureRandom.uuid}", first_name: "Leon", last_name: "Shimizu", role: :admin)
admin.save!
puts "  Admin: #{admin.full_name} (#{admin.email})"

# Pre-create instructor — placeholder clerk_id gets replaced on first Clerk sign-in
instructor = User.find_or_initialize_by(email: "alanna@anyonecanlearntocode.com")
instructor.assign_attributes(clerk_id: instructor.clerk_id.presence || "pending_#{SecureRandom.uuid}", first_name: "Alanna", last_name: "Shimizu", role: :instructor)
instructor.save!
puts "  Instructor: #{instructor.full_name} (#{instructor.email})"

# Import prework curriculum from JSON (exported from prework-grader production).
# Falls back to legacy CSV if JSON file doesn't exist yet.
json_path = Rails.root.join("..", "scripts", "prework_exercises.json")
if File.exist?(json_path)
  puts "  Importing prework from JSON..."
  Rake::Task["curriculum:import_prework"].invoke
else
  puts "  JSON not found at #{json_path}, falling back to CSV import..."
  Rake::Task["curriculum:import_csv"].invoke
end

# Create Cohort 3
curriculum = Curriculum.find_by!(name: "CSG Full-Stack Bootcamp 2026")

cohort = Cohort.find_or_create_by!(name: "Cohort 3") do |c|
  c.cohort_type = :bootcamp
  c.curriculum = curriculum
  c.start_date = Date.new(2026, 3, 2)
  c.end_date = Date.new(2026, 6, 30)
  c.github_organization_name = "code-school-of-guam"
  c.repository_name = "prework-exercises"
  c.requires_github = false
  c.status = :active
end
puts "  Cohort: #{cohort.name} (#{cohort.status}, starts #{cohort.start_date})"

puts "Done seeding!"
