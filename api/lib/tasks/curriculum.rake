require "json"

namespace :curriculum do
  desc "Import prework exercises from JSON exported from csg-prework-grader production"
  task import_prework: :environment do
    json_path = ENV.fetch("JSON_PATH", Rails.root.join("..", "scripts", "prework_exercises.json"))

    unless File.exist?(json_path)
      puts "JSON file not found at #{json_path}"
      puts "Export from prework-grader prod first:"
      puts "  rails runner scripts/export_prework_json.rb > prework_exercises.json"
      exit 1
    end

    require "reverse_markdown"

    exercises = JSON.parse(File.read(json_path))
    puts "Importing #{exercises.size} exercises from #{json_path}..."

    curriculum = Curriculum.find_or_create_by!(name: "CSG Full-Stack Bootcamp 2026") do |c|
      c.description = "Code School of Guam Full-Stack Web Development Bootcamp — prework through capstone"
      c.total_weeks = 5
      c.status = :active
    end
    puts "  Curriculum: #{curriculum.name} (id: #{curriculum.id})"

    prework = CurriculumModule.find_or_create_by!(curriculum: curriculum, name: "Prework") do |m|
      m.module_type = :prework
      m.position = 1
      m.description = "5 weeks of prework exercises covering programming fundamentals"
      m.total_days = 35
      m.day_offset = 0
      m.schedule_days = "weekdays_sat"
    end
    prework.update!(schedule_days: "weekdays_sat") if prework.schedule_days != "weekdays_sat"
    puts "  Module: #{prework.name} (id: #{prework.id})"

    lesson_position = 0
    lessons_created = 0
    blocks_created = 0

    exercises.each do |ex|
      title = ex["title"]&.strip
      next if title.blank?

      release_day = ex["release_day"].to_i
      video_url   = ex["video_url"]&.strip.presence
      filename    = ex["filename"]&.strip.presence
      solution    = ex["solution"]&.strip.presence

      instructions_html = ex["instructions_html"]&.strip.presence
      body = if instructions_html
        html_to_markdown(instructions_html)
      end

      lesson_position += 1

      lesson_type = if video_url.present? && body.blank?
        :video
      elsif body.present?
        :exercise
      else
        :reading
      end

      lesson = Lesson.find_or_initialize_by(
        curriculum_module: prework,
        title: title,
        release_day: release_day
      )
      new_lesson = lesson.new_record?
      lesson.assign_attributes(
        lesson_type: lesson_type,
        position: lesson_position,
        required: true
      )
      lesson.save!
      lessons_created += 1 if new_lesson

      block_position = 0

      if video_url.present?
        block_position += 1
        cb = ContentBlock.find_or_initialize_by(
          lesson: lesson,
          block_type: :video,
          position: block_position
        )
        new_block = cb.new_record?
        cb.assign_attributes(video_url: video_url, title: title)
        cb.save!
        blocks_created += 1 if new_block
      end

      if body.present?
        block_position += 1
        cb = ContentBlock.find_or_initialize_by(
          lesson: lesson,
          block_type: :exercise,
          position: block_position
        )
        new_block = cb.new_record?
        cb.assign_attributes(
          title: title,
          body: body,
          solution: solution,
          filename: filename
        )
        cb.save!
        blocks_created += 1 if new_block
      end
    end

    total_lessons = prework.lessons.count
    total_blocks = ContentBlock.joins(:lesson).where(lessons: { module_id: prework.id }).count
    puts "  Processed #{exercises.size} exercises → #{total_lessons} lessons, #{total_blocks} content blocks"
    puts "  (#{lessons_created} new lessons, #{blocks_created} new blocks this run)"
    puts "Done!"
  end

  desc "[Legacy] Import exercises from CSV into curriculum structure"
  task import_csv: :environment do
    require "csv"

    csv_path = ENV.fetch("CSV_PATH", Rails.root.join("..", "scripts", "exercises.csv"))

    unless File.exist?(csv_path)
      puts "CSV file not found at #{csv_path}"
      exit 1
    end

    puts "Importing from #{csv_path}..."

    curriculum = Curriculum.find_or_create_by!(name: "CSG Full-Stack Bootcamp 2026") do |c|
      c.description = "Code School of Guam Full-Stack Web Development Bootcamp — prework through capstone"
      c.total_weeks = 5
      c.status = :active
    end
    puts "  Curriculum: #{curriculum.name} (id: #{curriculum.id})"

    prework = CurriculumModule.find_or_create_by!(curriculum: curriculum, name: "Prework") do |m|
      m.module_type = :prework
      m.position = 1
      m.description = "5 weeks of prework exercises covering programming fundamentals"
      m.total_days = 35
      m.day_offset = 0
    end
    puts "  Module: #{prework.name} (id: #{prework.id})"

    rows = CSV.read(csv_path, headers: true, liberal_parsing: true)
    puts "  Found #{rows.size} rows"

    lesson_position = 0

    rows.each do |row|
      title = row["title"]&.strip
      next if title.blank?

      lesson_position += 1
      release_day  = row["release_day"].to_i
      video_url    = row["video_url"]&.strip
      instructions = row["instructions"]&.strip
      solution     = row["solution"]&.strip
      filename     = row["filename"]&.strip

      lesson_type = if video_url.present? && instructions.blank?
        :video
      elsif instructions.present?
        :exercise
      else
        :reading
      end

      lesson = Lesson.find_or_create_by!(
        curriculum_module: prework,
        title: title,
        release_day: release_day
      ) do |l|
        l.lesson_type = lesson_type
        l.position = lesson_position
        l.required = true
      end

      block_position = 0

      if video_url.present?
        block_position += 1
        ContentBlock.find_or_create_by!(
          lesson: lesson,
          block_type: :video,
          video_url: video_url
        ) do |cb|
          cb.position = block_position
          cb.title = title
        end
      end

      if instructions.present?
        block_position += 1
        ContentBlock.find_or_create_by!(
          lesson: lesson,
          block_type: :exercise,
          position: block_position
        ) do |cb|
          cb.title = title
          cb.body = instructions
          cb.solution = solution
          cb.filename = filename
        end
      end
    end

    total_lessons = prework.lessons.count
    total_blocks = ContentBlock.joins(:lesson).where(lessons: { module_id: prework.id }).count
    puts "  Created #{total_lessons} lessons with #{total_blocks} content blocks"
    puts "Done!"
  end
end

def html_to_markdown(html)
  return html unless html.include?("<")

  md = ReverseMarkdown.convert(html, unknown_tags: :bypass, github_flavored: true)
  md.strip
    .gsub(/\n{3,}/, "\n\n")        # collapse excessive blank lines
    .gsub(/[ \t]+$/, "")            # trim trailing whitespace per line
end
