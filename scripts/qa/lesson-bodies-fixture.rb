# Writes the Markdown body of every lesson block the prework import creates
# (scripts/prework_exercises.json, production-authored course content) to
# web/src/test/fixtures/prework-lesson-bodies.json, for the shared editor's
# round-trip tests. Uses the import task's own html_to_markdown, so the
# bodies match what `curriculum:import_prework` stores.
#
#   cd api && bundle exec ruby ../scripts/qa/lesson-bodies-fixture.rb
require "json"
require "rake"
require "reverse_markdown"
require "active_support/core_ext/object/blank"
include Rake::DSL

root = File.expand_path("../..", __dir__)
load File.join(root, "api/lib/tasks/curriculum.rake")

exercises = JSON.parse(File.read(File.join(root, "scripts/prework_exercises.json")))
bodies = exercises.filter_map do |exercise|
  html = exercise["instructions_html"]&.strip.presence
  next unless html && exercise["title"]&.strip.present?
  { title: exercise["title"].strip, body: html_to_markdown(html) }
end

path = File.join(root, "web/src/test/fixtures/prework-lesson-bodies.json")
File.write(path, "#{JSON.pretty_generate(bodies)}\n")
puts "#{bodies.size} lesson bodies written to #{path}"
