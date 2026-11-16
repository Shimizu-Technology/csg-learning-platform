# Optional production-authored course pass, using the canonical export already in Git.
# Synthetic people only; the boot guard permits an owned local csg_qa_ database.
require_relative "boot"
require "rake"
Rails.application.load_tasks
Rake::Task["curriculum:import_prework"].invoke
curriculum = Curriculum.find_by!(name: "CSG Full-Stack Bootcamp 2026")
mod = curriculum.modules.find_by!(name: "Prework")
rows = []
[ ["program", [3, 4, 5]], ["self_paced", [6, 7]], ["alumni", [8]] ].each do |delivery, ids|
  cohort = Cohort.create!(name: "QA canonical #{delivery}", curriculum: curriculum, status: :active,
    start_date: 120.days.ago.to_date, cohort_type: delivery == "alumni" ? :alumni : :bootcamp,
    course_delivery: delivery == "self_paced" ? :self_paced : :program)
  cohort.instructors << User.find(2)
  cohort.update!(support_instructor: User.find(2)) if delivery == "self_paced"
  ids.each do |id|
    enrollment = Enrollment.create!(cohort: cohort, user_id: id, status: id == 5 ? :paused : :active)
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true) unless delivery == "alumni"
    rows << { user_id: id, cohort_id: cohort.id, enrollment_id: enrollment.id, paused: id == 5, alumni: delivery == "alumni" }
  end
end
path = Rails.root.join("..", ".qa-local", "student-workspace", "course-fixture.json")
FileUtils.mkdir_p(path.dirname)
path.write(JSON.pretty_generate({ module_id: mod.id, module_name: mod.name, lesson_count: mod.lessons.count, people: rows }))
puts "Canonical curriculum QA metadata: #{path} (#{mod.lessons.count} lessons)"
