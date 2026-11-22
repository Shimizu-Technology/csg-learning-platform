# W9.3 learner reminders: forces the real hourly tick at chosen Guam times
# and checks what each synthetic learner received. From api/, after
# w9-nudges-fixtures.rb:
#   DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/w9-nudges-harness.rb
#   ... w9-nudges-harness.rb tick <day> <hour>   # one forced tick (the browser spec uses this)
# Day N is N days after the course start (fixtures). The clock is moved with
# ActiveSupport time travel for the whole process, so the tick, enrollment
# expiry and "today" all agree. Email goes to a local stub that writes
# .qa-local/w9-nudges-emails.jsonl; no provider is called.
require_relative "boot"
require "active_support/testing/time_helpers"
include ActiveSupport::Testing::TimeHelpers

GUAM = ActiveSupport::TimeZone["Pacific/Guam"]
IDS = JSON.parse(Rails.root.join("..", ".qa-local", "w9-nudges.json").read)
START = Date.iso8601(IDS.fetch("start"))
EMAILS = Rails.root.join("..", ".qa-local", "w9-nudges-emails.jsonl")
ENV["RESEND_API_KEY"] = "re_qa_stub"
ENV["RESEND_FROM_EMAIL"] = "CSG QA <qa@example.invalid>"
Resend::Emails.define_singleton_method(:send) do |params, options: {}|
  File.open(EMAILS, "a") { |file| file.puts({ to: params[:to], subject: params[:subject], at: Time.current.iso8601 }.to_json) }
  { id: "qa-stub" }
end
TASK = ScheduledTick::TASKS.find { |task| task.name == "learner_nudges" }

def at(day, hour, minute = 0) = GUAM.local(START.year, START.month, START.day, hour, minute) + day.days

def tick(day, hour, minute = 0)
  now = at(day, hour, minute)
  travel_to(now) do
    log = StringIO.new
    ScheduledTick.new(now: now, tasks: [ TASK ], logger: ActiveSupport::Logger.new(log)).call
    JSON.parse(log.string[/\{.*\}/m]).fetch("tasks").first
  end
end

def enrollment_id(user) = IDS.dig("learners", user.to_s, "enrollment")

def keys(user) = LearnerNudge.where(enrollment_id: enrollment_id(user)).order(:id).map { |nudge| "#{nudge.kind}/#{nudge.threshold}" }

def activity!(user, day)
  record = User.find(user)
  ActivityEvent.create!(actor: record, subject_user: record, cohort_id: IDS.fetch("paced"), event_type: "checkpoint_completed", created_at: at(day, 10))
end

if ARGV.first == "tick"
  result = tick(Integer(ARGV[1]), Integer(ARGV[2]))
  puts({ result: result, nudges: IDS.fetch("learners").keys.to_h { |user| [ user, keys(user) ] } }.to_json)
  exit
end

EMAILS.delete if EMAILS.exist?
ledger = []
check = lambda do |name, condition, detail|
  ledger << { scenario: name, result: condition ? "passed" : "failed", detail: detail }
  puts "#{condition ? 'PASS' : 'FAIL'} #{name}: #{detail}"
end

# Staff extend 972's final date from day 20 to day 27 before any reminder;
# the extension also moves 972's unfinished weekly milestones a week later.
extended_to = (START + 27).in_time_zone(GUAM).end_of_day
Enrollment.find(enrollment_id(972)).learner_extensions.new(scope: "final", submissions_close_at: extended_to, reason: "QA: family emergency").record_change!(actor: User.find(1))

tick(5, 20)
check.call("No milestone reminder 28h before week 1 ends", keys(971).empty?, "day 5 20:00: 971=#{keys(971)}")
tick(6, 8)
week = LearnerNudge.where(enrollment_id: enrollment_id(971)).sole
check.call("Week 1 milestone reminder on its due day, naming open lessons", keys(971) == [ "due_soon/24h" ] && week.key.include?("/milestone/") && week.title == "Week 1: due today",
  "971=#{week.key} #{week.title.inspect} #{week.body.inspect}")
check.call("The extension moved 972's week 1 milestone, so no reminder for the old date", keys(972).empty?, "972=#{keys(972)}")
# Learners 971, 972 and 975 last worked on day 17, so inactivity starts on day 24.
[ 971, 972, 975 ].each { |user| activity!(user, 17) }

first = tick(18, 20)
check.call("No early reminder 52h before the final date", keys(971) == [ "due_soon/24h" ] && keys(975) == [ "due_soon/24h" ], "day 18 20:00: 971=#{keys(971)} 975=#{keys(975)}")
check.call("Access ending notice is essential and reaches an opted-out learner", keys(973) == [ "access_ending/14d" ], "973=#{keys(973)}; claimed=#{first['claimed']}")
quiet = [ tick(18, 23), tick(19, 3), tick(19, 7, 59) ]
check.call("Quiet hours (21:00-08:00 Guam) send nothing", quiet.all? { |result| result["quiet_hours"] } && keys(971) == [ "due_soon/24h" ], "quiet_hours=#{quiet.map { |result| result['quiet_hours'] }}; 971=#{keys(971)}")
morning = tick(19, 8)
check.call("The 48h reminder deferred overnight goes out at 08:00, once", keys(971) == %w[due_soon/24h due_soon/48h] && keys(975) == %w[due_soon/24h due_soon/48h], "971=#{keys(971)} 975=#{keys(975)}; claimed=#{morning['claimed']}")
rerun = tick(19, 9) # next hour slot, so the task really runs again
direct = travel_to(at(19, 9, 30)) { LearnerNudges.new.call(now: at(19, 9, 30)) }
overlap = []
travel_to(at(19, 10)) do
  logs = 2.times.map { StringIO.new }
  threads = logs.map { |log| Thread.new { ScheduledTick.new(now: at(19, 10), tasks: [ TASK ], logger: ActiveSupport::Logger.new(log)).call } }
  threads.each(&:join)
  overlap = logs.map { |log| JSON.parse(log.string[/\{.*\}/m]).fetch("tasks").first.slice("name", "status", "claimed") }
end
check.call("A rerun, a direct rerun and two overlapping ticks send nothing new", rerun["status"] == "run" && rerun["claimed"].zero? && direct[:claimed].zero? && overlap.map { |item| item["status"] }.sort == %w[overlap run] && overlap.sum { |item| item["claimed"].to_i }.zero? && keys(971) == %w[due_soon/24h due_soon/48h] && Notification.where(user_id: 971).count == 2,
  "rerun status=#{rerun['status']} claimed=#{rerun['claimed']}; direct claimed=#{direct[:claimed]}; overlap returns=#{overlap}; 971 notifications=#{Notification.where(user_id: 971).count}")
check.call("An extension cancels the old final date's reminder", keys(972).none? { |key| key.start_with?("due_soon") }, "972 on day 19=#{keys(972)}")
tick(19, 13)
check.call("Access 3-day notice, and the daily cap holds other reminders", keys(973) == %w[access_ending/14d access_ending/3d] && keys(971) == %w[due_soon/24h due_soon/48h], "973=#{keys(973)} 971=#{keys(971)}")
tick(20, 8)
final = LearnerNudge.where(enrollment_id: enrollment_id(971)).order(:id).last
check.call("24h final reminder on the due day outranks the week-3 milestone", keys(971) == %w[due_soon/24h due_soon/48h due_soon/24h] && final.title == "Final project due today" && final.key.include?("/final/"), "971=#{LearnerNudge.where(enrollment_id: enrollment_id(971)).order(:id).pluck(:key)}; title=#{final.title.inspect}")
tick(26, 8)
moved = LearnerNudge.where(enrollment_id: enrollment_id(972)).order(:id).to_a
final_moved = moved.select { |nudge| nudge.key.include?("/final/") }
check.call("The extended date gets its own 48h reminder", final_moved.map(&:threshold) == [ "48h" ] && final_moved.first.event_at.to_i == extended_to.to_i, "972=#{moved.map(&:key)}")
check.call("Inactivity after 7 days with open work", keys(971).include?("inactive/7d"), "971=#{keys(971)}")
check.call("The Off program cohort (Cohort 3's shape) gets nothing", keys(974).empty? && Notification.where(user_id: 974).none?, "974=#{keys(974)}")
sent = EMAILS.exist? ? EMAILS.readlines.map { |line| JSON.parse(line) } : []
check.call("Email goes once per reminder, never to the Off learner", sent.size == LearnerNudge.where(email_status: "sent").count && sent.none? { |mail| mail["to"].include?("974") },
  "#{sent.size} emails; subjects=#{sent.map { |mail| mail['subject'].sub(/ - .*/, '') }.tally}")

Rails.root.join("..", ".qa-local", "w9-nudges-ledger.json").write(JSON.pretty_generate(ledger))
failed = ledger.count { |entry| entry[:result] == "failed" }
puts "#{ledger.size - failed}/#{ledger.size} harness scenarios passed"
exit(failed.zero? ? 0 : 1)
