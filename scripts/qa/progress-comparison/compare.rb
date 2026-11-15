# Compares two dump.rb outputs (old server, new server) and prints Markdown:
# where the old consumers disagreed with each other, what the single new
# answer is, and every value that changed between the two servers.
# Usage: ruby compare.rb OLD.json NEW.json
require "json"

old_dump = JSON.parse(File.read(ARGV.fetch(0)))
new_dump = JSON.parse(File.read(ARGV.fetch(1)))

def answers(learner)
  learner["dashboard"]["lessons"].keys.to_h do |id|
    # What each client shows: the server's learner_status when the payload has
    # one, otherwise the status the client derives locally.
    today = learner["dashboard"]["lessons"][id]
    views = { "Today" => today["learner_status"] || today["client_status"] }
    views["Weekly plan"] = learner["weekly"]["items"][id] if learner["weekly"]["items"].key?(id)
    views["Personal plan"] = learner.dig("plan", "lessons", id) if learner.dig("plan", "lessons")&.key?(id)
    page = learner["pages"][id]
    views["Lesson page"] = page["learner_status"] || page["page_status"] if page["http"] == 200
    [ id, views ]
  end
end

def next_steps(learner)
  steps = { "Today" => learner["dashboard"]["next"] }
  steps["Weekly plan"] = learner["weekly"]["next"] if learner["weekly"]["mode"] == "self_paced"
  steps["Personal plan"] = learner["plan"]["next"] if learner["plan"]
  page_steps = learner["pages"].values.select { |page| page["http"] == 200 }.map { |page| page["next_step"] }.uniq
  steps["Lesson page"] = page_steps.first if page_steps.size == 1 && learner["pages"].values.any? { |page| page.key?("next_step") && page["learner_status"] }
  steps
end

def flatten(value, prefix = nil, out = {})
  case value
  when Hash then value.each { |key, child| flatten(child, prefix ? "#{prefix}.#{key}" : key.to_s, out) }
  else out[prefix] = value
  end
  out
end

title = ->(learner, id) { id ? "#{learner['titles'][id.to_s] || id} (#{id})" : "none" }
total_changes = 0
puts "| Learner state | Old disagreements | New single answer |"
puts "|---|---|---|"
old_dump.each do |name, old|
  new = new_dump.fetch(name)
  disagreements = answers(old).filter_map do |id, views|
    next if views.values.uniq.size <= 1

    "#{old['titles'][id]}: " + views.map { |view, status| "#{view} #{status}" }.join(", ")
  end
  old["dashboard"]["lessons"].each do |id, lesson|
    status = answers(old)[id]["Today"]
    disagreements << "#{old['titles'][id]}: Today and the staff view count it complete while it reads #{status}" if lesson["completed"] && !%w[done awaiting_review].include?(status)
    if new["weekly"]["items"].key?(id) && !old["weekly"]["items"].key?(id)
      disagreements << "#{old['titles'][id]}: the weekly plan leaves it out while it reads #{status}"
    end
  end
  old_next = next_steps(old)
  if old_next.values.uniq.size > 1
    disagreements << "Next: " + old_next.map { |view, id| "#{view} #{title.call(old, id)}" }.join(", ")
  elsif old_next.values.first != next_steps(new).values.first
    target = old_next.values.first
    disagreements << "Next: #{old_next.keys.join(', ')} #{title.call(old, target)}, which reads #{target ? answers(old)[target.to_s]['Today'] : 'nothing'}"
  end
  new_answers = answers(new)
  conflicts = new_answers.select { |_id, views| views.values.uniq.size > 1 }
  new_next = next_steps(new)
  raise "#{name}: new consumers still disagree on #{conflicts.keys.inspect}" if conflicts.any?
  raise "#{name}: new next steps disagree #{new_next.inspect}" if new_next.values.uniq.size > 1

  changed_status = new_answers.filter_map do |id, views|
    old_status = answers(old)[id]["Today"]
    new_status = views["Today"]
    "#{new['titles'][id]} #{new_status}" if old_status != new_status || disagreements.any? { |text| text.start_with?("#{new['titles'][id]}:") }
  end
  single = [ "Next: #{title.call(new, new_next.values.first)}" ] + changed_status
  puts "| #{name.tr('_', ' ')} | #{disagreements.empty? ? 'None' : disagreements.join('<br>')} | #{single.join('<br>')} |"
end

puts
puts "## Value changes"
puts
old_dump.each do |name, old|
  new = new_dump.fetch(name)
  before = flatten(old.except("titles"))
  after = flatten(new.except("titles"))
  changes = (before.keys | after.keys).filter_map do |key|
    next if key.end_with?(".learner_status", ".next_step", ".client_status", ".page_status") || key.start_with?("weekly.items.", "plan.lessons.")
    next if before[key] == after[key]

    "`#{key}`: #{before[key].inspect} -> #{after[key].inspect}"
  end
  total_changes += changes.size
  puts "- **#{name.tr('_', ' ')}**: #{changes.empty? ? 'no payload value changes' : changes.join('; ')}"
end
puts
puts "#{total_changes} payload values changed across #{old_dump.size} learners (statuses derived on the client are listed in the table above)."
