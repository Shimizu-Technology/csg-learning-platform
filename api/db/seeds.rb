puts "Seeding database..."

# Create admin user (Leon)
admin = User.find_or_create_by!(email: "codeschoolofguam@gmail.com") do |u|
  u.clerk_id = "admin_leon_clerk_id"
  u.first_name = "Leon"
  u.last_name = "Shimizu"
  u.role = :admin
end
puts "  Admin: #{admin.full_name} (#{admin.email})"

# Create instructor (Alanna)
instructor = User.find_or_create_by!(email: "alanna@anyonecanlearntocode.com") do |u|
  u.clerk_id = "instructor_alanna_clerk_id"
  u.first_name = "Alanna"
  u.last_name = "Shimizu"
  u.role = :instructor
end
puts "  Instructor: #{instructor.full_name} (#{instructor.email})"

# Run CSV import
puts "  Importing CSV exercises..."
Rake::Task["curriculum:import_csv"].invoke

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
