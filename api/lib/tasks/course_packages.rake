# frozen_string_literal: true

namespace :course_packages do
  desc "Convert a Markdown course repository into a schema-v1 course package JSON"
  task :convert_markdown, [ :source_dir, :output_json ] => :environment do |_task, args|
    source_dir = args[:source_dir].to_s.strip
    output_json = args[:output_json].to_s.strip
    dry_run = ENV["DRY_RUN"] == "1" || ENV["DRY_RUN"] == "true"
    compact = ENV["COMPACT"] == "1" || ENV["COMPACT"] == "true"

    if source_dir.empty?
      abort "Usage: bin/rails 'course_packages:convert_markdown[SOURCE_DIR,OUTPUT_JSON]'"
    end

    converter = CoursePackageMarkdownConverter.new(source_dir)
    package = converter.call
    json = converter.serialize(package, compact: compact)
    CoursePackageImporter.new(JSON.parse(json))
    summary = CoursePackageMarkdownConverter.summarize(package, json)

    if dry_run || output_json.empty?
      puts "Verified course package: #{summary[:key]} (revision #{summary[:revision]})"
      puts "  Modules: #{summary[:modules]}, Lessons: #{summary[:lessons]}, Blocks: #{summary[:blocks]}, Size: #{summary[:bytes]} bytes"
      puts json unless dry_run
    else
      CoursePackageMarkdownConverter.write_atomically(output_json, json)
      puts "Wrote #{output_json} (#{summary[:modules]} modules, #{summary[:lessons]} lessons, #{summary[:blocks]} blocks, #{summary[:bytes]} bytes)"
    end
  rescue CoursePackageMarkdownConverter::Error, CoursePackageImporter::InvalidPackage => error
    abort "Error: #{error.message}"
  end
end
