# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_02_27_010009) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "cohorts", force: :cascade do |t|
    t.integer "cohort_type", default: 0, null: false
    t.datetime "created_at", null: false
    t.bigint "curriculum_id", null: false
    t.date "end_date"
    t.string "github_organization_name"
    t.string "name", null: false
    t.string "repository_name", default: "prework-exercises"
    t.boolean "requires_github", default: false, null: false
    t.jsonb "settings", default: {}, null: false
    t.date "start_date", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["curriculum_id"], name: "index_cohorts_on_curriculum_id"
    t.index ["status"], name: "index_cohorts_on_status"
  end

  create_table "content_blocks", force: :cascade do |t|
    t.integer "block_type", default: 0, null: false
    t.text "body"
    t.datetime "created_at", null: false
    t.string "filename"
    t.bigint "lesson_id", null: false
    t.jsonb "metadata", default: {}, null: false
    t.integer "position", default: 0, null: false
    t.text "solution"
    t.string "title"
    t.datetime "updated_at", null: false
    t.string "video_url"
    t.index ["block_type"], name: "index_content_blocks_on_block_type"
    t.index ["lesson_id", "position"], name: "index_content_blocks_on_lesson_id_and_position"
    t.index ["lesson_id"], name: "index_content_blocks_on_lesson_id"
  end

  create_table "curricula", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.integer "status", default: 0, null: false
    t.integer "total_weeks"
    t.datetime "updated_at", null: false
  end

  create_table "enrollments", force: :cascade do |t|
    t.bigint "cohort_id", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.datetime "enrolled_at"
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["cohort_id"], name: "index_enrollments_on_cohort_id"
    t.index ["user_id", "cohort_id"], name: "index_enrollments_on_user_id_and_cohort_id", unique: true
    t.index ["user_id"], name: "index_enrollments_on_user_id"
  end

  create_table "lessons", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "lesson_type", default: 0, null: false
    t.bigint "module_id", null: false
    t.integer "position", default: 0, null: false
    t.integer "release_day", default: 0, null: false
    t.boolean "required", default: true, null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["module_id", "position"], name: "index_lessons_on_module_id_and_position"
    t.index ["module_id", "release_day"], name: "index_lessons_on_module_id_and_release_day"
    t.index ["module_id"], name: "index_lessons_on_module_id"
  end

  create_table "module_assignments", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "enrollment_id", null: false
    t.bigint "module_id", null: false
    t.date "unlock_date_override"
    t.boolean "unlocked", default: true, null: false
    t.datetime "updated_at", null: false
    t.index ["enrollment_id", "module_id"], name: "index_module_assignments_on_enrollment_id_and_module_id", unique: true
    t.index ["enrollment_id"], name: "index_module_assignments_on_enrollment_id"
    t.index ["module_id"], name: "index_module_assignments_on_module_id"
  end

  create_table "modules", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "curriculum_id", null: false
    t.integer "day_offset", default: 0, null: false
    t.text "description"
    t.integer "module_type", default: 0, null: false
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.integer "total_days"
    t.datetime "updated_at", null: false
    t.index ["curriculum_id", "position"], name: "index_modules_on_curriculum_id_and_position"
    t.index ["curriculum_id"], name: "index_modules_on_curriculum_id"
  end

  create_table "progresses", force: :cascade do |t|
    t.datetime "completed_at"
    t.bigint "content_block_id", null: false
    t.datetime "created_at", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["content_block_id"], name: "index_progresses_on_content_block_id"
    t.index ["user_id", "content_block_id"], name: "index_progresses_on_user_id_and_content_block_id", unique: true
    t.index ["user_id"], name: "index_progresses_on_user_id"
  end

  create_table "submissions", force: :cascade do |t|
    t.bigint "content_block_id", null: false
    t.datetime "created_at", null: false
    t.text "feedback"
    t.string "github_code_url"
    t.string "github_issue_url"
    t.integer "grade"
    t.datetime "graded_at"
    t.bigint "graded_by_id"
    t.integer "num_submissions", default: 1, null: false
    t.text "text"
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["content_block_id", "user_id"], name: "index_submissions_on_content_block_id_and_user_id"
    t.index ["content_block_id"], name: "index_submissions_on_content_block_id"
    t.index ["graded_by_id"], name: "index_submissions_on_graded_by_id"
    t.index ["user_id"], name: "index_submissions_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.string "avatar_url"
    t.string "clerk_id", null: false
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "first_name"
    t.string "github_username"
    t.string "last_name"
    t.datetime "last_sign_in_at"
    t.integer "role", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["clerk_id"], name: "index_users_on_clerk_id", unique: true
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  add_foreign_key "cohorts", "curricula", column: "curriculum_id"
  add_foreign_key "content_blocks", "lessons"
  add_foreign_key "enrollments", "cohorts"
  add_foreign_key "enrollments", "users"
  add_foreign_key "lessons", "modules"
  add_foreign_key "module_assignments", "enrollments"
  add_foreign_key "module_assignments", "modules"
  add_foreign_key "modules", "curricula", column: "curriculum_id"
  add_foreign_key "progresses", "content_blocks"
  add_foreign_key "progresses", "users"
  add_foreign_key "submissions", "content_blocks"
  add_foreign_key "submissions", "users"
  add_foreign_key "submissions", "users", column: "graded_by_id"
end
