# Read-only: asks Today, the weekly plan, the personal plan, every lesson page
# and the staff learner view what each synthetic learner's lessons look like,
# and writes the answers as JSON. Learner statuses are derived the way the
# clients derive them, so old and new servers can be compared field for field.
# Usage (from the api/ directory of the checkout to measure):
#   RAILS_ENV=test DATABASE_URL=... bin/rails runner ../scripts/qa/progress-comparison/dump.rb OUT.json
require "action_dispatch/testing/integration"
abort "Run in test mode" unless Rails.env.test?
abort "Use a local csg_qa_ database" unless ActiveRecord::Base.connection_db_config.database.match?(/\Acsg_qa_[a-z0-9_]+\z/)
out = ARGV.fetch(0)

# web/src/lib/learningStatus.ts and mobile/src/lib/learning-status.ts
def learner_lesson_status(completed: false, available: true, submissions_closed: false, review_status: nil, partial: false)
  return "redo" if review_status == "redo_requested"
  return "awaiting_review" if review_status == "awaiting_review" && completed
  return "done" if completed
  return "upcoming" unless available
  return "closed" if submissions_closed
  return "in_progress" if partial

  "open"
end

REVIEWED = %w[text_submission repo_url_submission repo_and_live_url_submission].freeze
COUNTS_AS_DONE = %w[manual_complete prework_github_sync].freeze

# mobile lessonLearnerProgress: the lesson page's own status from its blocks.
def lesson_page_status(lesson)
  blocks = lesson.fetch("content_blocks")
  gradable = ->(b) { %w[exercise code_challenge].include?(b["block_type"]) || (b["block_type"] == "checkpoint" && !b["knowledge_check"] && REVIEWED.include?(b["submission_type"].to_s)) }
  empty_video = ->(b) { %w[video recording].include?(b["block_type"]) && !b["completion_required"] && !b["video_url"] && !b["has_s3_video"] && b["body"].to_s.strip.empty? }
  explicit = blocks.select { |b| b["completion_required"] }
  steps = explicit.any? ? explicit : blocks.select { |b| (b["block_type"] != "text" || b["progress"]) && !empty_video.call(b) }
  done = waiting = redos = 0
  steps.each do |b|
    latest = Array(b["submissions"]).max_by { |s| [ s["created_at"], s["id"] ] }
    if latest && gradable.call(b)
      if latest["grade"] == "R" then redos += 1
      elsif latest["grade"].nil? then waiting += 1
      else done += 1
      end
    elsif !(gradable.call(b) && !COUNTS_AS_DONE.include?(b["effective_submission_type"].to_s)) && b.dig("progress", "status") == "completed"
      done += 1
    end
  end
  return "open" if steps.empty?

  review = redos.positive? ? "redo_requested" : waiting.positive? ? "awaiting_review" : nil
  learner_lesson_status(completed: done + waiting == steps.size, review_status: review, partial: done + waiting + redos > 0)
end

session = ActionDispatch::Integration::Session.new(Rails.application)
request = lambda do |user, path|
  ApiRateLimits::STORE.clear
  session.get path, headers: { "Authorization" => "Bearer test_token_#{user.id}" }
  [ session.response.status, session.response.status == 200 ? JSON.parse(session.response.body) : nil ]
end
staff = User.find_by!(clerk_id: "cmp_instructor")

result = User.where(role: :student).where("clerk_id LIKE 'cmp_%'").order(:id).to_h do |user|
  enrollment = user.enrollments.first
  _, body = request.call(user, "/api/v1/dashboard")
  dashboard = body.fetch("dashboard")
  lessons = dashboard.fetch("modules").flat_map { |mod| mod.fetch("lessons") }
  plan = dashboard["personal_plan"]
  _, weekly_body = request.call(user, "/api/v1/weekly_plan?cohort_id=#{enrollment.cohort_id}")
  weekly = weekly_body.fetch("weekly_plan")
  _, staff_view = request.call(staff, "/api/v1/progress/student/#{user.id}?cohort_id=#{enrollment.cohort_id}")
  staff_lessons = staff_view.fetch("modules").flat_map { |mod| mod.fetch("lessons") }.index_by { |lesson| lesson["id"] }

  pages = lessons.to_h do |lesson|
    status, page = request.call(user, "/api/v1/lessons/#{lesson['id']}?cohort_id=#{enrollment.cohort_id}")
    page = page&.fetch("lesson")
    [ lesson["id"].to_s, {
      http: status,
      page_status: page && lesson_page_status(page),
      learner_status: page&.dig("learner_status"),
      next_step: page&.dig("next_step", "id"),
      next_nav: page&.dig("next_lesson", "id"),
      prev_nav: page&.dig("prev_lesson", "id")
    } ]
  end

  [ user.clerk_id.delete_prefix("cmp_"), {
    titles: lessons.to_h { |lesson| [ lesson["id"].to_s, lesson["title"] ] },
    dashboard: {
      next: dashboard.dig("continue_lesson", "id"),
      overall: dashboard["overall_progress"],
      modules: dashboard["modules"].map { |mod| mod.slice("id", "completed_blocks", "total_blocks") },
      action_items: dashboard["action_items"].map { |item| item["submission_id"] },
      lessons: lessons.to_h do |lesson|
        [ lesson["id"].to_s, lesson.slice("completed", "completed_blocks", "total_blocks", "available", "review_status").merge(
          "client_status" => learner_lesson_status(completed: lesson["completed"], available: lesson["available"],
            submissions_closed: lesson.dig("submission_window", "submissions_closed"), review_status: lesson["review_status"], partial: lesson["completed_blocks"].positive?),
          "learner_status" => lesson["learner_status"]
        ) ]
      end
    },
    weekly: {
      mode: weekly["plan_kind"] || weekly["mode"] || "weekly",
      next: weekly.dig("course_overview", "next_lesson", "lesson_id"),
      summary: weekly["summary"],
      redos: Array(weekly["redos"]).map { |item| item["submission_id"] },
      items: (Array(weekly["required"]) + Array(weekly["optional"])).to_h do |item|
        [ item["lesson_id"].to_s, item["learner_status"] || learner_lesson_status(completed: item["state"] == "completed", available: item["state"] != "upcoming",
          submissions_closed: item["state"] == "closed", review_status: item["review_status"]) ]
      end
    },
    plan: plan && {
      next: plan.dig("next_lesson", "lesson_id"),
      completed_count: plan["completed_count"],
      lessons: plan["milestones"].flat_map { |milestone| milestone["lessons"] }.to_h do |lesson|
        [ lesson["lesson_id"].to_s, lesson["learner_status"] || learner_lesson_status(completed: lesson["completed"], available: lesson["available"], review_status: lesson["review_status"]) ]
      end
    },
    pages: pages,
    staff: {
      overall: staff_view["overall_progress"],
      lessons: staff_lessons.transform_keys(&:to_s).transform_values { |lesson| lesson.slice("completed", "completed_blocks", "available") }
    }
  } ]
end

File.write(out, JSON.pretty_generate(result))
puts "Wrote #{result.size} learners to #{out}"
