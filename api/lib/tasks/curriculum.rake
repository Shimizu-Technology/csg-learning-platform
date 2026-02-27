require "csv"

namespace :curriculum do
  desc "Import exercises from CSV into curriculum structure"
  task import_csv: :environment do
    csv_path = ENV.fetch("CSV_PATH", Rails.root.join("..", "scripts", "exercises.csv"))

    unless File.exist?(csv_path)
      puts "CSV file not found at #{csv_path}"
      exit 1
    end

    puts "Importing from #{csv_path}..."

    # Create curriculum
    curriculum = Curriculum.find_or_create_by!(name: "CSG Full-Stack Bootcamp 2026") do |c|
      c.description = "Code School of Guam Full-Stack Web Development Bootcamp — prework through capstone"
      c.total_weeks = 5
      c.status = :active
    end
    puts "  Curriculum: #{curriculum.name} (id: #{curriculum.id})"

    # Create prework module
    prework = CurriculumModule.find_or_create_by!(curriculum: curriculum, name: "Prework") do |m|
      m.module_type = :prework
      m.position = 1
      m.description = "5 weeks of prework exercises covering programming fundamentals"
      m.total_days = 35
      m.day_offset = 0
    end
    puts "  Module: #{prework.name} (id: #{prework.id})"

    # Parse CSV
    rows = CSV.read(csv_path, headers: true, liberal_parsing: true)
    puts "  Found #{rows.size} rows"

    # Group by release_day to form lessons
    grouped = rows.group_by { |row| row["release_day"].to_i }

    lesson_position = 0

    grouped.sort_by { |day, _| day }.each do |release_day, day_rows|
      day_rows.each_with_index do |row, idx|
        title = row["title"]&.strip
        next if title.blank?

        lesson_position += 1

        # Determine lesson type
        video_url = row["video_url"]&.strip
        instructions = row["instructions"]&.strip
        solution = row["solution"]&.strip
        filename = row["filename"]&.strip

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

        # Create video content block if video URL present
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

        # Create exercise content block if instructions present
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

        # If only video with no instructions, still track it
        if video_url.present? && instructions.blank? && solution.blank?
          # Video-only lesson — just the video block is fine
        end
      end
    end

    total_lessons = prework.lessons.count
    total_blocks = ContentBlock.joins(:lesson).where(lessons: { module_id: prework.id }).count
    puts "  Created #{total_lessons} lessons with #{total_blocks} content blocks"
    puts "Done!"
  end
end
