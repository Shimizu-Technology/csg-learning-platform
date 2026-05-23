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

ActiveRecord::Schema[8.1].define(version: 2026_05_12_000100) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "announcements", force: :cascade do |t|
    t.datetime "archived_at"
    t.integer "audience", default: 0, null: false
    t.bigint "author_id", null: false
    t.text "body", null: false
    t.bigint "cohort_id"
    t.datetime "created_at", null: false
    t.boolean "pinned", default: false, null: false
    t.datetime "published_at"
    t.integer "status", default: 1, null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["audience", "cohort_id"], name: "index_announcements_on_audience_and_cohort_id"
    t.index ["author_id"], name: "index_announcements_on_author_id"
    t.index ["cohort_id"], name: "index_announcements_on_cohort_id"
    t.index ["status", "published_at"], name: "index_announcements_on_status_and_published_at"
  end

  create_table "cable_token_nonces", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "nonce", null: false
    t.datetime "updated_at", null: false
    t.datetime "used_at"
    t.bigint "user_id", null: false
    t.index ["expires_at"], name: "index_cable_token_nonces_on_expires_at"
    t.index ["nonce"], name: "index_cable_token_nonces_on_nonce", unique: true
    t.index ["user_id"], name: "index_cable_token_nonces_on_user_id"
  end

  create_table "channel_read_states", force: :cascade do |t|
    t.bigint "channel_id", null: false
    t.datetime "created_at", null: false
    t.datetime "last_read_at"
    t.bigint "last_read_message_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["channel_id"], name: "index_channel_read_states_on_channel_id"
    t.index ["last_read_message_id"], name: "index_channel_read_states_on_last_read_message_id"
    t.index ["user_id", "channel_id"], name: "index_channel_read_states_on_user_id_and_channel_id", unique: true
    t.index ["user_id"], name: "index_channel_read_states_on_user_id"
  end

  create_table "channels", force: :cascade do |t|
    t.bigint "cohort_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.integer "position", default: 0, null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.integer "visibility", default: 0, null: false
    t.bigint "workspace_id", null: false
    t.index ["cohort_id"], name: "index_channels_on_cohort_id"
    t.index ["workspace_id", "name"], name: "index_channels_on_workspace_id_and_name", unique: true
    t.index ["workspace_id", "status", "position"], name: "index_channels_on_workspace_id_and_status_and_position"
    t.index ["workspace_id"], name: "index_channels_on_workspace_id"
  end

  create_table "cohort_module_schedules", force: :cascade do |t|
    t.bigint "cohort_id", null: false
    t.datetime "created_at", null: false
    t.bigint "module_id", null: false
    t.date "start_date", null: false
    t.datetime "updated_at", null: false
    t.index ["cohort_id", "module_id"], name: "index_cohort_module_schedules_on_cohort_id_and_module_id", unique: true
    t.index ["cohort_id"], name: "index_cohort_module_schedules_on_cohort_id"
  end

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
    t.string "s3_video_content_type"
    t.integer "s3_video_duration_seconds"
    t.string "s3_video_key"
    t.bigint "s3_video_size"
    t.datetime "s3_video_uploaded_at"
    t.bigint "s3_video_uploaded_by_id"
    t.text "solution"
    t.jsonb "submission_config", default: {}, null: false
    t.integer "submission_type"
    t.string "title"
    t.datetime "updated_at", null: false
    t.string "video_url"
    t.index ["block_type"], name: "index_content_blocks_on_block_type"
    t.index ["lesson_id", "position"], name: "index_content_blocks_on_lesson_id_and_position"
    t.index ["lesson_id"], name: "index_content_blocks_on_lesson_id"
    t.index ["s3_video_uploaded_by_id"], name: "index_content_blocks_on_s3_video_uploaded_by_id"
    t.index ["submission_type"], name: "index_content_blocks_on_submission_type"
  end

  create_table "curricula", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.integer "status", default: 0, null: false
    t.integer "total_weeks"
    t.datetime "updated_at", null: false
  end

  create_table "direct_conversation_members", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "direct_conversation_id", null: false
    t.datetime "last_read_at"
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["direct_conversation_id", "user_id"], name: "idx_direct_members_unique", unique: true
    t.index ["direct_conversation_id"], name: "index_direct_conversation_members_on_direct_conversation_id"
    t.index ["user_id", "direct_conversation_id"], name: "idx_direct_members_user_conversation"
    t.index ["user_id"], name: "index_direct_conversation_members_on_user_id"
  end

  create_table "direct_conversations", force: :cascade do |t|
    t.bigint "cohort_id"
    t.datetime "created_at", null: false
    t.string "member_key", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "workspace_id", null: false
    t.index ["cohort_id"], name: "index_direct_conversations_on_cohort_id"
    t.index ["workspace_id", "member_key"], name: "index_direct_conversations_on_workspace_id_and_member_key", unique: true
    t.index ["workspace_id"], name: "index_direct_conversations_on_workspace_id"
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

  create_table "lesson_assignments", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "enrollment_id", null: false
    t.bigint "lesson_id", null: false
    t.date "unlock_date_override"
    t.boolean "unlocked", default: false, null: false
    t.datetime "updated_at", null: false
    t.index ["enrollment_id", "lesson_id"], name: "index_lesson_assignments_on_enrollment_id_and_lesson_id", unique: true
    t.index ["enrollment_id"], name: "index_lesson_assignments_on_enrollment_id"
    t.index ["lesson_id"], name: "index_lesson_assignments_on_lesson_id"
  end

  create_table "lessons", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "lesson_type", default: 0, null: false
    t.bigint "module_id", null: false
    t.integer "position", default: 0, null: false
    t.integer "release_day", default: 0, null: false
    t.boolean "required", default: true, null: false
    t.boolean "requires_submission", default: false, null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["module_id", "position"], name: "index_lessons_on_module_id_and_position"
    t.index ["module_id", "release_day"], name: "index_lessons_on_module_id_and_release_day"
    t.index ["module_id"], name: "index_lessons_on_module_id"
  end

  create_table "message_attachments", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "content_type", null: false
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.bigint "message_id", null: false
    t.string "s3_key", null: false
    t.datetime "updated_at", null: false
    t.bigint "uploaded_by_id", null: false
    t.index ["message_id"], name: "index_message_attachments_on_message_id"
    t.index ["s3_key"], name: "index_message_attachments_on_s3_key", unique: true
    t.index ["uploaded_by_id"], name: "index_message_attachments_on_uploaded_by_id"
  end

  create_table "message_preferences", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.boolean "muted", default: false, null: false
    t.bigint "target_id", null: false
    t.string "target_type", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["target_type", "target_id"], name: "index_message_preferences_on_target"
    t.index ["user_id", "target_type", "target_id"], name: "idx_message_preferences_unique", unique: true
    t.index ["user_id"], name: "index_message_preferences_on_user_id"
  end

  create_table "message_reactions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "emoji", null: false
    t.bigint "message_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["message_id", "user_id", "emoji"], name: "idx_message_reactions_unique", unique: true
    t.index ["message_id"], name: "index_message_reactions_on_message_id"
    t.index ["user_id"], name: "index_message_reactions_on_user_id"
  end

  create_table "messages", force: :cascade do |t|
    t.bigint "author_id", null: false
    t.text "body"
    t.bigint "channel_id"
    t.datetime "created_at", null: false
    t.datetime "deleted_at"
    t.bigint "direct_conversation_id"
    t.datetime "edited_at"
    t.bigint "mention_user_ids", default: [], null: false, array: true
    t.bigint "parent_message_id"
    t.datetime "pinned_at"
    t.bigint "pinned_by_id"
    t.datetime "updated_at", null: false
    t.index ["author_id"], name: "index_messages_on_author_id"
    t.index ["channel_id", "created_at"], name: "index_messages_on_channel_id_and_created_at"
    t.index ["channel_id", "deleted_at"], name: "index_messages_on_channel_id_and_deleted_at"
    t.index ["channel_id"], name: "index_messages_on_channel_id"
    t.index ["direct_conversation_id", "created_at"], name: "idx_messages_on_direct_conversation_created"
    t.index ["direct_conversation_id"], name: "index_messages_on_direct_conversation_id"
    t.index ["parent_message_id"], name: "index_messages_on_parent_message_id"
    t.index ["pinned_at"], name: "index_messages_on_pinned_at"
    t.index ["pinned_by_id"], name: "index_messages_on_pinned_by_id"
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
    t.string "schedule_days", default: "weekdays", null: false
    t.integer "total_days"
    t.datetime "updated_at", null: false
    t.index ["curriculum_id", "position"], name: "index_modules_on_curriculum_id_and_position"
    t.index ["curriculum_id"], name: "index_modules_on_curriculum_id"
  end

  create_table "notifications", force: :cascade do |t|
    t.bigint "actor_id"
    t.text "body"
    t.datetime "created_at", null: false
    t.bigint "notifiable_id", null: false
    t.string "notifiable_type", null: false
    t.integer "notification_type", default: 0, null: false
    t.string "path", null: false
    t.datetime "read_at"
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["actor_id"], name: "index_notifications_on_actor_id"
    t.index ["notifiable_type", "notifiable_id", "user_id"], name: "index_notifications_unique_source_per_user", unique: true
    t.index ["notifiable_type", "notifiable_id"], name: "index_notifications_on_notifiable"
    t.index ["user_id", "read_at", "created_at"], name: "index_notifications_on_user_id_and_read_at_and_created_at"
    t.index ["user_id"], name: "index_notifications_on_user_id"
  end

  create_table "progresses", force: :cascade do |t|
    t.datetime "completed_at"
    t.bigint "content_block_id", null: false
    t.datetime "created_at", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.integer "video_duration"
    t.integer "video_last_position", default: 0
    t.integer "video_total_watched", default: 0
    t.index ["content_block_id"], name: "index_progresses_on_content_block_id"
    t.index ["user_id", "content_block_id"], name: "index_progresses_on_user_id_and_content_block_id", unique: true
    t.index ["user_id"], name: "index_progresses_on_user_id"
  end

  create_table "push_subscriptions", force: :cascade do |t|
    t.string "auth", null: false
    t.datetime "created_at", null: false
    t.text "endpoint", null: false
    t.datetime "failed_at"
    t.datetime "last_seen_at"
    t.string "p256dh", null: false
    t.datetime "updated_at", null: false
    t.string "user_agent"
    t.bigint "user_id", null: false
    t.index ["endpoint"], name: "index_push_subscriptions_on_endpoint", unique: true
    t.index ["user_id", "failed_at"], name: "index_push_subscriptions_on_user_id_and_failed_at"
    t.index ["user_id"], name: "index_push_subscriptions_on_user_id"
  end

  create_table "recordings", force: :cascade do |t|
    t.bigint "cohort_id", null: false
    t.string "content_type", null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.integer "duration_seconds"
    t.bigint "file_size", null: false
    t.integer "position", default: 0, null: false
    t.datetime "recorded_date"
    t.string "s3_key", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.bigint "uploaded_by_id"
    t.index ["cohort_id", "position"], name: "index_recordings_on_cohort_id_and_position"
    t.index ["cohort_id"], name: "index_recordings_on_cohort_id"
    t.index ["s3_key"], name: "index_recordings_on_s3_key", unique: true
    t.index ["uploaded_by_id"], name: "index_recordings_on_uploaded_by_id"
  end

  create_table "solid_queue_blocked_executions", force: :cascade do |t|
    t.string "concurrency_key", null: false
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.index ["concurrency_key", "priority", "job_id"], name: "index_solid_queue_blocked_executions_for_release"
    t.index ["expires_at", "concurrency_key"], name: "index_solid_queue_blocked_executions_for_maintenance"
    t.index ["job_id"], name: "index_solid_queue_blocked_executions_on_job_id", unique: true
  end

  create_table "solid_queue_claimed_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.bigint "process_id"
    t.index ["job_id"], name: "index_solid_queue_claimed_executions_on_job_id", unique: true
    t.index ["process_id", "job_id"], name: "index_solid_queue_claimed_executions_on_process_id_and_job_id"
  end

  create_table "solid_queue_failed_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "error"
    t.bigint "job_id", null: false
    t.index ["job_id"], name: "index_solid_queue_failed_executions_on_job_id", unique: true
  end

  create_table "solid_queue_jobs", force: :cascade do |t|
    t.string "active_job_id"
    t.text "arguments"
    t.string "class_name", null: false
    t.string "concurrency_key"
    t.datetime "created_at", null: false
    t.datetime "finished_at"
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.datetime "scheduled_at"
    t.datetime "updated_at", null: false
    t.index ["active_job_id"], name: "index_solid_queue_jobs_on_active_job_id"
    t.index ["class_name"], name: "index_solid_queue_jobs_on_class_name"
    t.index ["finished_at"], name: "index_solid_queue_jobs_on_finished_at"
    t.index ["queue_name", "finished_at"], name: "index_solid_queue_jobs_for_filtering"
    t.index ["scheduled_at", "finished_at"], name: "index_solid_queue_jobs_for_alerting"
  end

  create_table "solid_queue_pauses", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "queue_name", null: false
    t.index ["queue_name"], name: "index_solid_queue_pauses_on_queue_name", unique: true
  end

  create_table "solid_queue_processes", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "hostname"
    t.string "kind", null: false
    t.datetime "last_heartbeat_at", null: false
    t.text "metadata"
    t.string "name", null: false
    t.integer "pid", null: false
    t.bigint "supervisor_id"
    t.index ["last_heartbeat_at"], name: "index_solid_queue_processes_on_last_heartbeat_at"
    t.index ["name", "supervisor_id"], name: "index_solid_queue_processes_on_name_and_supervisor_id", unique: true
    t.index ["supervisor_id"], name: "index_solid_queue_processes_on_supervisor_id"
  end

  create_table "solid_queue_ready_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.index ["job_id"], name: "index_solid_queue_ready_executions_on_job_id", unique: true
    t.index ["priority", "job_id"], name: "index_solid_queue_poll_all"
    t.index ["queue_name", "priority", "job_id"], name: "index_solid_queue_poll_by_queue"
  end

  create_table "solid_queue_recurring_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.datetime "run_at", null: false
    t.string "task_key", null: false
    t.index ["job_id"], name: "index_solid_queue_recurring_executions_on_job_id", unique: true
    t.index ["task_key", "run_at"], name: "index_solid_queue_recurring_executions_on_task_key_and_run_at", unique: true
  end

  create_table "solid_queue_recurring_tasks", force: :cascade do |t|
    t.text "arguments"
    t.string "class_name"
    t.string "command", limit: 2048
    t.datetime "created_at", null: false
    t.text "description"
    t.string "key", null: false
    t.integer "priority", default: 0
    t.string "queue_name"
    t.string "schedule", null: false
    t.boolean "static", default: true, null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_solid_queue_recurring_tasks_on_key", unique: true
    t.index ["static"], name: "index_solid_queue_recurring_tasks_on_static"
  end

  create_table "solid_queue_scheduled_executions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "job_id", null: false
    t.integer "priority", default: 0, null: false
    t.string "queue_name", null: false
    t.datetime "scheduled_at", null: false
    t.index ["job_id"], name: "index_solid_queue_scheduled_executions_on_job_id", unique: true
    t.index ["scheduled_at", "priority", "job_id"], name: "index_solid_queue_dispatch_all"
  end

  create_table "solid_queue_semaphores", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "key", null: false
    t.datetime "updated_at", null: false
    t.integer "value", default: 1, null: false
    t.index ["expires_at"], name: "index_solid_queue_semaphores_on_expires_at"
    t.index ["key", "value"], name: "index_solid_queue_semaphores_on_key_and_value"
    t.index ["key"], name: "index_solid_queue_semaphores_on_key", unique: true
  end

  create_table "submissions", force: :cascade do |t|
    t.string "branch"
    t.string "commit_sha"
    t.bigint "content_block_id", null: false
    t.datetime "created_at", null: false
    t.text "feedback"
    t.string "github_code_url"
    t.string "github_issue_url"
    t.integer "grade"
    t.datetime "graded_at"
    t.bigint "graded_by_id"
    t.string "live_url"
    t.text "notes"
    t.integer "num_submissions", default: 1, null: false
    t.string "pr_url"
    t.string "repo_url"
    t.integer "submission_type"
    t.text "text"
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["content_block_id", "user_id"], name: "index_submissions_on_content_block_id_and_user_id"
    t.index ["content_block_id"], name: "index_submissions_on_content_block_id"
    t.index ["graded_by_id"], name: "index_submissions_on_graded_by_id"
    t.index ["submission_type"], name: "index_submissions_on_submission_type"
    t.index ["user_id"], name: "index_submissions_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "archived_at"
    t.string "avatar_url"
    t.string "clerk_id", null: false
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "first_name"
    t.string "github_username"
    t.string "last_name"
    t.datetime "last_seen_at"
    t.datetime "last_sign_in_at"
    t.integer "role", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["archived_at"], name: "index_users_on_archived_at"
    t.index ["clerk_id"], name: "index_users_on_clerk_id", unique: true
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["last_seen_at"], name: "index_users_on_last_seen_at"
  end

  create_table "watch_progresses", force: :cascade do |t|
    t.boolean "completed", default: false, null: false
    t.datetime "created_at", null: false
    t.integer "duration_seconds"
    t.integer "last_position_seconds", default: 0, null: false
    t.datetime "last_watched_at"
    t.bigint "recording_id", null: false
    t.integer "total_watched_seconds", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["recording_id"], name: "index_watch_progresses_on_recording_id"
    t.index ["user_id", "recording_id"], name: "index_watch_progresses_on_user_id_and_recording_id", unique: true
    t.index ["user_id"], name: "index_watch_progresses_on_user_id"
  end

  create_table "workspace_memberships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "role", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.bigint "workspace_id", null: false
    t.index ["user_id"], name: "index_workspace_memberships_on_user_id"
    t.index ["workspace_id", "user_id"], name: "index_workspace_memberships_on_workspace_id_and_user_id", unique: true
    t.index ["workspace_id"], name: "index_workspace_memberships_on_workspace_id"
  end

  create_table "workspaces", force: :cascade do |t|
    t.bigint "cohort_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.string "slug", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.integer "workspace_type", default: 0, null: false
    t.index ["cohort_id"], name: "index_workspaces_on_cohort_id"
    t.index ["cohort_id"], name: "index_workspaces_on_cohort_id_unique", unique: true, where: "(cohort_id IS NOT NULL)"
    t.index ["slug"], name: "index_workspaces_on_slug", unique: true
  end

  add_foreign_key "announcements", "cohorts"
  add_foreign_key "announcements", "users", column: "author_id"
  add_foreign_key "cable_token_nonces", "users"
  add_foreign_key "channel_read_states", "channels"
  add_foreign_key "channel_read_states", "messages", column: "last_read_message_id"
  add_foreign_key "channel_read_states", "users"
  add_foreign_key "channels", "cohorts"
  add_foreign_key "channels", "workspaces"
  add_foreign_key "cohort_module_schedules", "cohorts"
  add_foreign_key "cohort_module_schedules", "modules"
  add_foreign_key "cohorts", "curricula", column: "curriculum_id"
  add_foreign_key "content_blocks", "lessons"
  add_foreign_key "content_blocks", "users", column: "s3_video_uploaded_by_id"
  add_foreign_key "direct_conversation_members", "direct_conversations"
  add_foreign_key "direct_conversation_members", "users"
  add_foreign_key "direct_conversations", "cohorts"
  add_foreign_key "direct_conversations", "workspaces"
  add_foreign_key "enrollments", "cohorts"
  add_foreign_key "enrollments", "users"
  add_foreign_key "lesson_assignments", "enrollments"
  add_foreign_key "lesson_assignments", "lessons"
  add_foreign_key "lessons", "modules"
  add_foreign_key "message_attachments", "messages"
  add_foreign_key "message_attachments", "users", column: "uploaded_by_id"
  add_foreign_key "message_preferences", "users"
  add_foreign_key "message_reactions", "messages"
  add_foreign_key "message_reactions", "users"
  add_foreign_key "messages", "channels"
  add_foreign_key "messages", "direct_conversations"
  add_foreign_key "messages", "messages", column: "parent_message_id"
  add_foreign_key "messages", "users", column: "author_id"
  add_foreign_key "messages", "users", column: "pinned_by_id"
  add_foreign_key "module_assignments", "enrollments"
  add_foreign_key "module_assignments", "modules"
  add_foreign_key "modules", "curricula", column: "curriculum_id"
  add_foreign_key "notifications", "users"
  add_foreign_key "notifications", "users", column: "actor_id"
  add_foreign_key "progresses", "content_blocks"
  add_foreign_key "progresses", "users"
  add_foreign_key "push_subscriptions", "users"
  add_foreign_key "recordings", "cohorts"
  add_foreign_key "recordings", "users", column: "uploaded_by_id", on_delete: :nullify
  add_foreign_key "solid_queue_blocked_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_claimed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_failed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_ready_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_recurring_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_scheduled_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "submissions", "content_blocks"
  add_foreign_key "submissions", "users"
  add_foreign_key "submissions", "users", column: "graded_by_id"
  add_foreign_key "watch_progresses", "recordings"
  add_foreign_key "watch_progresses", "users"
  add_foreign_key "workspace_memberships", "users"
  add_foreign_key "workspace_memberships", "workspaces"
  add_foreign_key "workspaces", "cohorts"
end
