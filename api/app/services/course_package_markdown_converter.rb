require "date"
require "fileutils"
require "json"
require "pathname"
require "securerandom"
require "strscan"
require "yaml"

# Converts a Markdown course repository into a deterministic schema-v1 JSON
# course package compatible with CoursePackageImporter.
#
# Kept free of Rails runtime dependencies so the CLI can run fast standalone,
# while remaining directly testable and verifiable against CoursePackageImporter.
class CoursePackageMarkdownConverter
  class Error < StandardError
    attr_reader :path, :line

    def initialize(message, path: nil, line: nil)
      @path = path
      @line = line
      location = [ path, line ].compact.join(":")
      super(location.empty? ? message : "#{location}: #{message}")
    end
  end

  SCHEMA_VERSION = 1
  MAX_BYTES = 2 * 1024 * 1024
  IDENTIFIER = /\A[a-z0-9][a-z0-9-]{0,79}\z/
  TEXT_LIMIT = 100_000
  MAX_MODULES = 20
  MAX_LESSONS = 250
  MAX_BLOCKS_PER_LESSON = 20
  MAX_TITLE_LENGTH = 160
  MAX_REVISION_LENGTH = 80
  MAX_FILENAME_LENGTH = 160
  MAX_RUBRIC_CRITERIA = 12
  MAX_CRITERION_DESCRIPTION = 1_500
  TOTAL_WEEKS_RANGE = 1..52
  TOTAL_DAYS_RANGE = 1..365

  SCHEDULE_PATTERNS = {
    "weekdays" => [ 0, 1, 2, 3, 4 ],
    "mon_thu" => [ 0, 1, 2, 3 ],
    "weekdays_sat" => [ 0, 1, 2, 3, 4, 5 ],
    "mwf" => [ 0, 2, 4 ],
    "tth" => [ 1, 3 ],
    "daily" => [ 0, 1, 2, 3, 4, 5, 6 ]
  }.freeze

  MODULE_TYPES = %w[prework live_class capstone advanced workshop recording].freeze
  LESSON_TYPES = %w[video exercise reading project checkpoint].freeze
  BLOCK_TYPES = %w[video text exercise code_challenge checkpoint recording].freeze
  SUBMISSION_TYPES = %w[
    manual_complete
    text_submission
    repo_url_submission
    repo_and_live_url_submission
  ].freeze

  DEFAULT_BLOCK_TYPE_FOR_LESSON = {
    "video" => "video",
    "reading" => "text",
    "exercise" => "exercise",
    "project" => "exercise",
    "checkpoint" => "checkpoint"
  }.freeze

  COURSE_KEYS = %w[schema_version key revision title description total_weeks module_type].freeze
  MODULE_KEYS = %w[key title description total_days schedule_days module_type].freeze
  LESSON_KEYS = %w[
    key title lesson_type release_day required blocks
    block_key block_type block_title filename submission_type rubric solution solution_file
  ].freeze
  SINGLE_BLOCK_SHORTCUT_KEYS = %w[
    block_key block_type block_title filename submission_type rubric solution solution_file
  ].freeze
  BLOCK_KEYS = %w[
    key block_type type title body solution solution_file filename submission_type rubric
  ].freeze
  RUBRIC_KEYS = %w[title description criteria].freeze
  CRITERION_KEYS = %w[title description].freeze

  MEDIA_KEY_PATTERN = /video|s3|media_url/i
  MEDIA_BODY_URI_PATTERN = /\b(?:https?|s3):\/\//i
  MEDIA_BODY_S3_KEY_PATTERN = /(?:\A|[\s"'`(>=])\/?(?:content_videos|recordings|message_attachments|course_resource_uploads|uploads|videos)\/\S+/i

  FRONTMATTER_DELIMITER = /\A---[ \t]*\z/
  BLOCK_MULTILINE_OPEN = /\A {0,3}<!--\s*block\s*\z/
  BLOCK_MULTILINE_CLOSE = /\A {0,3}-->[ \t]*\z/
  BLOCK_SINGLE_LINE = /\A {0,3}<!--\s*block(?::[ \t]*|[ \t]+)(.+?)\s*-->[ \t]*\z/
  SOLUTION_MARKER = /\A {0,3}<!--\s*solution\s*-->[ \t]*\z/
  END_SOLUTION_MARKER = /\A {0,3}<!--\s*endsolution\s*-->[ \t]*\z/
  KV_ATTR_PREFIX = /\A[a-zA-Z_][a-zA-Z0-9_-]*=/
  YAML_ATTR_PREFIX = /\A(?:[a-zA-Z_][a-zA-Z0-9_-]*|"[^"]+"|'[^']+')\s*:/
  THEMATIC_BREAK = /\A(?:-[ \t]*){3,}\z|\A(?:\*[ \t]*){3,}\z|\A(?:_[ \t]*){3,}\z/
  LIST_ITEM_MARKER = /\A([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*)|\z)/

  def self.convert(source_dir, output_path: nil, compact: false)
    converter = new(source_dir)
    package = converter.call
    json = converter.serialize(package, compact: compact)

    if output_path
      write_atomically(output_path, json)
    end

    {
      package: package,
      json: json,
      summary: summarize(package, json)
    }
  end

  def self.summarize(package, json)
    modules = package.fetch("modules")
    lesson_count = modules.sum { |mod| mod.fetch("lessons").size }
    block_count = modules.sum { |mod| mod.fetch("lessons").sum { |lesson| lesson.fetch("blocks").size } }
    {
      key: package.fetch("key"),
      revision: package.fetch("revision"),
      title: package.fetch("title"),
      modules: modules.size,
      lessons: lesson_count,
      blocks: block_count,
      bytes: json.bytesize
    }
  end

  def self.write_atomically(output_path, content)
    target = Pathname.new(output_path.to_s)
    dir = target.dirname
    FileUtils.mkdir_p(dir)
    encoded = content.encode(Encoding::UTF_8)

    tmp = nil
    file = nil
    10.times do
      candidate = File.join(dir.to_s, ".#{target.basename}.tmp.#{Process.pid}.#{SecureRandom.hex(12)}")
      begin
        file = File.open(candidate, File::WRONLY | File::CREAT | File::EXCL | File::BINARY, 0o600)
        tmp = candidate
        break
      rescue Errno::EEXIST
        next
      end
    end
    raise Error, "Failed to create temporary output file in #{dir}" unless file

    begin
      file.chmod(0o600)
      file.write(encoded)
      file.flush
      file.fsync
    ensure
      file.close unless file.closed?
    end

    File.rename(tmp, target.to_s)
    tmp = nil
  ensure
    if tmp
      begin
        File.unlink(tmp)
      rescue Errno::ENOENT
        nil
      end
    end
  end

  def initialize(source_dir)
    @source_dir = source_dir.to_s
    raise Error, "Source directory is required" if @source_dir.strip.empty?
    raise Error, "Source directory does not exist: #{@source_dir}" unless File.exist?(@source_dir)
    raise Error, "Source path is not a directory: #{@source_dir}" unless File.directory?(@source_dir)

    @root_path = File.realpath(@source_dir)
  end

  def call
    course_manifest_path = find_yaml_manifest(@root_path, "course")
    course_data = load_yaml_hash(course_manifest_path)
    course_rel = relative_path(course_manifest_path)

    reject_unknown_keys!(course_data, COURSE_KEYS, path: course_rel)
    if course_data.key?("schema_version") && course_data["schema_version"] != SCHEMA_VERSION
      fail_at!("Unsupported schema version (expected #{SCHEMA_VERSION})", path: course_rel)
    end

    key = validate_identifier!(course_data["key"], "course key", path: course_rel)
    revision = normalize_revision!(course_data["revision"], path: course_rel)
    title = validate_text!(course_data["title"], MAX_TITLE_LENGTH, "course title", required: true, path: course_rel)
    description = validate_text!(course_data["description"], TEXT_LIMIT, "course description", required: false, path: course_rel)
    total_weeks = validate_integer!(course_data["total_weeks"], TOTAL_WEEKS_RANGE, "total_weeks", path: course_rel)
    default_module_type = validate_optional_module_type!(course_data["module_type"], course_data.key?("module_type"), path: course_rel)

    module_dirs = discover_module_directories
    if module_dirs.empty? || module_dirs.size > MAX_MODULES
      fail_at!("Expected between 1 and #{MAX_MODULES} modules, found #{module_dirs.size}", path: course_rel)
    end

    index_course_lessons!(module_dirs)

    modules = []
    seen_module_keys = {}
    total_lessons = 0

    module_dirs.each do |mod_dir|
      mod = convert_module(mod_dir, default_module_type: default_module_type)
      mod_rel = relative_path(mod_dir)
      if seen_module_keys.key?(mod.fetch("key"))
        fail_at!("Duplicate module key '#{mod.fetch("key")}' (already defined in #{seen_module_keys[mod.fetch("key")]})", path: mod_rel)
      end
      seen_module_keys[mod.fetch("key")] = mod_rel

      total_lessons += mod.fetch("lessons").size
      if total_lessons > MAX_LESSONS
        fail_at!("Too many lessons across course (max #{MAX_LESSONS})", path: mod_rel)
      end

      modules << mod
    end

    package = {
      "schema_version" => SCHEMA_VERSION,
      "key" => key,
      "revision" => revision,
      "title" => title
    }
    package["description"] = description unless description.nil?
    package["total_weeks"] = total_weeks
    package["modules"] = modules

    validate_byte_limit!(JSON.generate(package), path: course_rel)
    package
  end

  def to_json(compact: false)
    package = call
    serialize(package, compact: compact)
  end

  def serialize(package, compact: false)
    json = compact ? JSON.generate(package) : "#{JSON.pretty_generate(package)}\n"
    validate_byte_limit!(json, path: relative_path(@root_path))
    json
  end

  private

  def discover_module_directories
    modules_subdir = File.join(@root_path, "modules")
    if File.directory?(modules_subdir)
      ensure_within_root!(modules_subdir, context_path: "modules")
      Dir.children(modules_subdir)
        .reject { |entry| entry.start_with?(".") }
        .sort
        .map { |entry| File.join(modules_subdir, entry) }
        .select { |path| File.directory?(path) }
        .each { |path| ensure_within_root!(path, context_path: relative_path(path)) }
    else
      Dir.children(@root_path)
        .reject { |entry| entry.start_with?(".") || entry == "solutions" }
        .sort
        .map { |entry| File.join(@root_path, entry) }
        .select { |path| File.directory?(path) && manifest_present?(path, "module") }
        .each { |path| ensure_within_root!(path, context_path: relative_path(path)) }
    end
  end

  def discover_lesson_files(mod_dir)
    lessons_subdir = File.join(mod_dir, "lessons")
    search_dir = if File.directory?(lessons_subdir)
      ensure_within_root!(lessons_subdir, context_path: relative_path(lessons_subdir))
      lessons_subdir
    else
      mod_dir
    end

    Dir.children(search_dir)
      .reject { |entry| entry.start_with?(".") }
      .select { |entry| entry.downcase.end_with?(".md") }
      .reject { |entry| search_dir == mod_dir && entry.casecmp?("readme.md") }
      .sort
      .map { |entry| File.join(search_dir, entry) }
      .select { |path| File.file?(path) }
      .each { |path| ensure_within_root!(path, context_path: relative_path(path)) }
  end

  def index_course_lessons!(module_dirs)
    @discovered_lesson_realpaths = {}
    @lesson_key_modules = Hash.new { |h, k| h[k] = [] }

    module_dirs.each do |mod_dir|
      lesson_files = discover_lesson_files(mod_dir)
      lesson_files.each do |lesson_path|
        real = File.realpath(lesson_path)
        @discovered_lesson_realpaths[real] = relative_path(lesson_path)
      end

      next if lesson_files.size > MAX_LESSONS

      seen_in_module = {}
      lesson_files.each do |lesson_path|
        lesson_key = peek_lesson_key(lesson_path)
        next unless lesson_key && !seen_in_module.key?(lesson_key)

        seen_in_module[lesson_key] = true
        @lesson_key_modules[lesson_key] << mod_dir
      end
    end
  end

  def peek_lesson_key(lesson_path)
    rel = relative_path(lesson_path)
    content = safe_read_utf8(lesson_path, context_path: rel)
    frontmatter, = split_frontmatter(content, path: rel)
    key = frontmatter["key"]
    key.is_a?(String) && IDENTIFIER.match?(key) ? key : nil
  rescue Error
    nil
  end

  def convert_module(mod_dir, default_module_type:)
    manifest_path = find_yaml_manifest(mod_dir, "module")
    mod_data = load_yaml_hash(manifest_path)
    mod_rel = relative_path(manifest_path)

    reject_unknown_keys!(mod_data, MODULE_KEYS, path: mod_rel)
    key = validate_identifier!(mod_data["key"], "module key", path: mod_rel)
    title = validate_text!(mod_data["title"], MAX_TITLE_LENGTH, "module title", required: true, path: mod_rel)
    description = validate_text!(mod_data["description"], TEXT_LIMIT, "module description", required: false, path: mod_rel)
    total_days = validate_integer!(mod_data["total_days"], TOTAL_DAYS_RANGE, "total_days", path: mod_rel)
    schedule_days = validate_schedule_days!(mod_data["schedule_days"], path: mod_rel)

    explicit_module_type = if mod_data.key?("module_type")
      validate_optional_module_type!(mod_data["module_type"], true, path: mod_rel)
    else
      default_module_type
    end

    lesson_files = discover_lesson_files(mod_dir)
    if lesson_files.empty? || lesson_files.size > MAX_LESSONS
      fail_at!("Module '#{key}' must contain between 1 and #{MAX_LESSONS} lessons, found #{lesson_files.size}", path: mod_rel)
    end

    lessons = []
    seen_lesson_keys = {}
    lesson_files.each do |lesson_path|
      lesson = convert_lesson(lesson_path, module_key: key, total_days: total_days, schedule_days: schedule_days)
      lesson_rel = relative_path(lesson_path)
      if seen_lesson_keys.key?(lesson.fetch("key"))
        fail_at!("Duplicate lesson key '#{lesson.fetch("key")}' (already defined in #{seen_lesson_keys[lesson.fetch("key")]})", path: lesson_rel, line: 1)
      end
      seen_lesson_keys[lesson.fetch("key")] = lesson_rel
      lessons << lesson
    end

    result = {
      "key" => key,
      "title" => title
    }
    result["description"] = description unless description.nil?
    result["module_type"] = explicit_module_type unless explicit_module_type.nil?
    result["total_days"] = total_days
    result["schedule_days"] = schedule_days
    result["lessons"] = lessons
    result
  end

  def convert_lesson(lesson_path, module_key:, total_days:, schedule_days:)
    rel = relative_path(lesson_path)
    content = safe_read_utf8(lesson_path, context_path: rel)
    frontmatter, body_lines, body_start_line = split_frontmatter(content, path: rel)

    reject_media_keys!(frontmatter, path: rel, line: 1)
    reject_unknown_keys!(frontmatter, LESSON_KEYS, path: rel, line: 1)

    key = validate_identifier!(frontmatter["key"], "lesson key", path: rel, line: 1)
    title = validate_text!(frontmatter["title"], MAX_TITLE_LENGTH, "lesson title", required: true, path: rel, line: 1)
    lesson_type = validate_enum!(frontmatter["lesson_type"], LESSON_TYPES, "lesson_type", path: rel, line: 1)
    release_day = validate_release_day!(frontmatter["release_day"], total_days: total_days, schedule_days: schedule_days, path: rel, line: 1)
    required = validate_boolean!(frontmatter["required"], "required", path: rel, line: 1)

    blocks = parse_lesson_blocks(
      frontmatter: frontmatter,
      module_key: module_key,
      lesson_key: key,
      lesson_type: lesson_type,
      body_lines: body_lines,
      body_start_line: body_start_line,
      path: rel
    )

    if blocks.empty? || blocks.size > MAX_BLOCKS_PER_LESSON
      fail_at!("Lesson '#{key}' must have between 1 and #{MAX_BLOCKS_PER_LESSON} blocks, found #{blocks.size}", path: rel, line: 1)
    end

    seen_block_keys = {}
    blocks.each do |block|
      bkey = block.fetch("key")
      if seen_block_keys.key?(bkey)
        fail_at!("Duplicate block key '#{bkey}' in lesson '#{key}'", path: rel)
      end
      seen_block_keys[bkey] = true
    end

    {
      "key" => key,
      "title" => title,
      "lesson_type" => lesson_type,
      "release_day" => release_day,
      "required" => required,
      "blocks" => blocks
    }
  end

  def parse_lesson_blocks(frontmatter:, module_key:, lesson_key:, lesson_type:, body_lines:, body_start_line:, path:)
    sections = parse_body_sections(body_lines, start_line: body_start_line, path: path)
    fm_blocks = frontmatter["blocks"]
    has_markers = sections[:mode] == :multi

    if has_markers || !fm_blocks.nil?
      used_shortcuts = SINGLE_BLOCK_SHORTCUT_KEYS.select { |k| frontmatter.key?(k) }
      if used_shortcuts.any?
        fail_at!(
          "Cannot mix single-block frontmatter keys (#{used_shortcuts.join(", ")}) with multi-block markers or frontmatter 'blocks'",
          path: path,
          line: 1
        )
      end
      build_multi_blocks(
        fm_blocks: fm_blocks,
        sections: sections,
        module_key: module_key,
        lesson_key: lesson_key,
        path: path
      )
    else
      build_single_block(
        frontmatter: frontmatter,
        module_key: module_key,
        lesson_key: lesson_key,
        lesson_type: lesson_type,
        section: sections[:single],
        path: path
      )
    end
  end

  def build_single_block(frontmatter:, module_key:, lesson_key:, lesson_type:, section:, path:)
    attrs = {
      "key" => frontmatter.fetch("block_key", "main"),
      "block_type" => frontmatter.fetch("block_type", DEFAULT_BLOCK_TYPE_FOR_LESSON.fetch(lesson_type))
    }
    attrs["title"] = frontmatter["block_title"] if frontmatter.key?("block_title")
    attrs["filename"] = frontmatter["filename"] if frontmatter.key?("filename")
    attrs["submission_type"] = frontmatter["submission_type"] if frontmatter.key?("submission_type")
    attrs["rubric"] = frontmatter["rubric"] if frontmatter.key?("rubric")
    attrs["solution"] = frontmatter["solution"] if frontmatter.key?("solution")
    attrs["solution_file"] = frontmatter["solution_file"] if frontmatter.key?("solution_file")

    [
      finalize_block(
        attrs: attrs,
        inline_body: section[:body],
        inline_solution: section[:solution],
        module_key: module_key,
        lesson_key: lesson_key,
        single_block_lesson: true,
        path: path,
        line: section[:line]
      )
    ]
  end

  def build_multi_blocks(fm_blocks:, sections:, module_key:, lesson_key:, path:)
    if sections[:mode] == :single
      # Metadata-only multi-block lesson using frontmatter `blocks:` Array
      unless fm_blocks.is_a?(Array)
        fail_at!("Frontmatter 'blocks' without <!-- block ... --> markers must be an array of block objects", path: path, line: 1)
      end
      unless sections[:single][:body].strip.empty? && sections[:single][:solution].nil?
        fail_at!("Body content in a lesson with frontmatter 'blocks' must be inside <!-- block ... --> markers", path: path, line: sections[:single][:line])
      end

      single_block_lesson = fm_blocks.size == 1
      fm_blocks.each_with_index.map do |raw_block, idx|
        unless raw_block.is_a?(Hash)
          fail_at!("Frontmatter blocks[#{idx}] must be an object", path: path, line: 1)
        end
        finalize_block(
          attrs: raw_block,
          inline_body: nil,
          inline_solution: nil,
          module_key: module_key,
          lesson_key: lesson_key,
          single_block_lesson: single_block_lesson,
          path: path,
          line: 1
        )
      end
    else
      fm_by_key = index_frontmatter_blocks(fm_blocks, path: path)
      used_fm_keys = {}
      marker_sections = sections[:blocks]
      single_block_lesson = marker_sections.size == 1

      blocks = marker_sections.map do |section|
        marker_attrs = section[:attrs]
        block_key = marker_attrs["key"]
        fail_at!("Block marker is missing required 'key'", path: path, line: section[:line]) if block_key.nil?

        fm_attrs = fm_by_key[block_key]
        used_fm_keys[block_key] = true if fm_attrs
        merged = merge_block_attrs(fm_attrs, marker_attrs, path: path, line: section[:line])

        finalize_block(
          attrs: merged,
          inline_body: section[:body],
          inline_solution: section[:solution],
          module_key: module_key,
          lesson_key: lesson_key,
          single_block_lesson: single_block_lesson,
          path: path,
          line: section[:line]
        )
      end

      unused_keys = fm_by_key.keys - used_fm_keys.keys
      if unused_keys.any?
        fail_at!("Frontmatter 'blocks' defines unused block key(s): #{unused_keys.join(", ")}", path: path, line: 1)
      end

      blocks
    end
  end

  def index_frontmatter_blocks(fm_blocks, path:)
    return {} if fm_blocks.nil?

    case fm_blocks
    when Hash
      fm_blocks.each_with_object({}) do |(k, v), acc|
        unless v.is_a?(Hash)
          fail_at!("Frontmatter blocks.#{k} must be an object", path: path, line: 1)
        end
        key_str = k.to_s
        if v.key?("key") && v["key"].to_s != key_str
          fail_at!("Frontmatter blocks.#{key_str} has mismatched inner key '#{v["key"]}'", path: path, line: 1)
        end
        acc[key_str] = v.merge("key" => key_str)
      end
    when Array
      fm_blocks.each_with_object({}) do |item, acc|
        unless item.is_a?(Hash)
          fail_at!("Each item in frontmatter 'blocks' array must be an object", path: path, line: 1)
        end
        key_str = item["key"]
        fail_at!("Each item in frontmatter 'blocks' array must include 'key'", path: path, line: 1) if key_str.nil?
        fail_at!("Duplicate block key '#{key_str}' in frontmatter 'blocks'", path: path, line: 1) if acc.key?(key_str)
        acc[key_str] = item
      end
    else
      fail_at!("Frontmatter 'blocks' must be a mapping or array", path: path, line: 1)
    end
  end

  def merge_block_attrs(fm_attrs, marker_attrs, path:, line:)
    return normalize_block_type_alias(marker_attrs, path: path, line: line) unless fm_attrs

    left = normalize_block_type_alias(fm_attrs, path: path, line: 1)
    right = normalize_block_type_alias(marker_attrs, path: path, line: line)

    merged = left.dup
    right.each do |k, v|
      if merged.key?(k) && merged[k] != v
        fail_at!("Conflicting '#{k}' between frontmatter blocks and block marker", path: path, line: line)
      end
      merged[k] = v
    end
    merged
  end

  def normalize_block_type_alias(attrs, path:, line:)
    reject_media_keys!(attrs, path: path, line: line)
    normalized = attrs.dup
    if normalized.key?("type")
      if normalized.key?("block_type") && normalized["block_type"] != normalized["type"]
        fail_at!("Conflicting 'type' and 'block_type' on block", path: path, line: line)
      end
      normalized["block_type"] = normalized.delete("type")
    end
    normalized
  end

  def finalize_block(attrs:, inline_body:, inline_solution:, module_key:, lesson_key:, single_block_lesson:, path:, line:)
    attrs = normalize_block_type_alias(attrs, path: path, line: line)
    block_type_raw = attrs["block_type"]
    if %w[video recording].include?(block_type_raw) && attrs.key?("url")
      fail_at!("Media must be attached through the normal upload flow", path: path, line: line)
    end
    reject_unknown_keys!(attrs, BLOCK_KEYS, path: path, line: line)

    key = validate_identifier!(attrs["key"], "block key", path: path, line: line)
    block_type = validate_enum!(attrs["block_type"], BLOCK_TYPES, "block_type", path: path, line: line)
    title = validate_text!(attrs["title"], MAX_TITLE_LENGTH, "block title", required: false, path: path, line: line)
    filename = validate_text!(attrs["filename"], MAX_FILENAME_LENGTH, "filename", required: false, path: path, line: line)
    submission_type = if attrs.key?("submission_type")
      validate_enum!(attrs["submission_type"], SUBMISSION_TYPES, "submission_type", path: path, line: line)
    else
      "manual_complete"
    end

    if attrs.key?("body") && !inline_body.nil? && !inline_body.strip.empty?
      fail_at!("Block '#{key}' cannot specify both frontmatter 'body' and Markdown body content", path: path, line: line)
    end
    body_raw = attrs.key?("body") ? attrs["body"] : (inline_body || "")
    if !body_raw.nil? && !body_raw.is_a?(String)
      fail_at!("Invalid block body: expected a string", path: path, line: line)
    end
    body = trim_blank_lines(body_raw)
    validate_text!(body, TEXT_LIMIT, "block body", required: false, path: path, line: line)

    if %w[video recording].include?(block_type) && media_reference_in_body?(body)
      fail_at!("Media must be attached through the normal upload flow (leave video/recording blocks without media URLs or S3 keys)", path: path, line: line)
    end

    solution = resolve_solution(
      attrs: attrs,
      inline_solution: inline_solution,
      module_key: module_key,
      lesson_key: lesson_key,
      block_key: key,
      single_block_lesson: single_block_lesson,
      path: path,
      line: line
    )

    rubric = validate_rubric!(attrs["rubric"], path: path, line: line) if attrs.key?("rubric")

    result = {
      "key" => key,
      "block_type" => block_type
    }
    result["title"] = title unless title.nil?
    result["body"] = body
    result["solution"] = solution unless solution.nil?
    result["filename"] = filename unless filename.nil?
    result["submission_type"] = submission_type
    result["rubric"] = rubric unless rubric.nil?
    result
  end

  def resolve_solution(attrs:, inline_solution:, module_key:, lesson_key:, block_key:, single_block_lesson:, path:, line:)
    sources = []

    unless inline_solution.nil?
      sources << [ :inline, trim_blank_lines(inline_solution) ]
    end

    if attrs.key?("solution") && !attrs["solution"].nil?
      unless attrs["solution"].is_a?(String)
        fail_at!("Invalid solution: expected a string", path: path, line: line)
      end
      sources << [ :attribute, trim_blank_lines(attrs["solution"]) ]
    end

    explicit_real = nil
    if attrs.key?("solution_file") && !attrs["solution_file"].nil?
      sol_path = resolve_explicit_solution_path(attrs["solution_file"], path: path, line: line)
      explicit_real = File.realpath(sol_path)
      sources << [ :solution_file, trim_blank_lines(safe_read_utf8(sol_path, context_path: path, line: line)) ]
    end

    convention_path = find_convention_solution_file(
      module_key: module_key,
      lesson_key: lesson_key,
      block_key: block_key,
      single_block_lesson: single_block_lesson,
      path: path,
      line: line,
      explicit_real: explicit_real
    )
    if convention_path && File.realpath(convention_path) != explicit_real
      sources << [ :solutions_dir, trim_blank_lines(safe_read_utf8(convention_path, context_path: path, line: line)) ]
    end

    if sources.size > 1
      names = sources.map(&:first).join(" and ")
      fail_at!("Conflicting solution sources (#{names}) for block '#{block_key}'", path: path, line: line)
    end

    return nil if sources.empty?

    value = sources.first.last
    validate_text!(value, TEXT_LIMIT, "solution", required: false, path: path, line: line)
    value.empty? ? nil : value
  end

  def trim_blank_lines(text)
    return "" if text.nil?
    return "" if text.match?(/\A[ \t\n]*\z/)

    text
      .sub(/\A(?:[ \t]*\n)+/, "")
      .sub(/(?:\n[ \t]*)+\z/, "")
  end

  def resolve_explicit_solution_path(rel_value, path:, line:)
    unless rel_value.is_a?(String) && !rel_value.strip.empty?
      fail_at!("solution_file must be a non-empty relative path", path: path, line: line)
    end
    if Pathname.new(rel_value).absolute?
      fail_at!("solution_file must be a relative path within the course repository: #{rel_value}", path: path, line: line)
    end

    candidate = File.expand_path(rel_value, @root_path)
    unless candidate == @root_path || candidate.start_with?("#{@root_path}#{File::SEPARATOR}")
      fail_at!("solution_file escapes source directory: #{rel_value}", path: path, line: line)
    end
    unless File.exist?(candidate)
      fail_at!("Referenced solution_file does not exist: #{rel_value}", path: path, line: line)
    end
    unless File.file?(candidate)
      fail_at!("Referenced solution_file is not a regular file: #{rel_value}", path: path, line: line)
    end

    real = ensure_within_root!(candidate, context_path: path, line: line)
    reject_discovered_lesson_solution!(real, path: path, line: line)
    candidate
  end

  def find_convention_solution_file(module_key:, lesson_key:, block_key:, single_block_lesson:, path:, line:, explicit_real: nil)
    solutions_root = File.join(@root_path, "solutions")
    return nil unless File.directory?(solutions_root)

    ensure_within_root!(solutions_root, context_path: "solutions")

    scoped_nested = File.join(solutions_root, module_key, lesson_key, "#{block_key}.md")
    scoped_flat = File.join(solutions_root, module_key, "#{lesson_key}.md")
    scoped_nested_exists = File.file?(scoped_nested)
    scoped_flat_exists = single_block_lesson && File.file?(scoped_flat)

    if scoped_nested_exists && scoped_flat_exists
      fail_at!(
        "Ambiguous solution files for '#{module_key}/#{lesson_key}/#{block_key}': both solutions/#{module_key}/#{lesson_key}.md and solutions/#{module_key}/#{lesson_key}/#{block_key}.md exist",
        path: path,
        line: line
      )
    end

    if scoped_nested_exists || scoped_flat_exists
      chosen = scoped_nested_exists ? scoped_nested : scoped_flat
      chosen_real = ensure_within_root!(chosen, context_path: path, line: line)
      reject_discovered_lesson_solution!(chosen_real, path: path, line: line)
      return chosen
    end

    nested = File.join(solutions_root, lesson_key, "#{block_key}.md")
    flat = File.join(solutions_root, "#{lesson_key}.md")

    nested_exists = File.file?(nested)
    flat_exists = single_block_lesson && File.file?(flat)

    if nested_exists && flat_exists
      fail_at!(
        "Ambiguous solution files for '#{lesson_key}/#{block_key}': both solutions/#{lesson_key}.md and solutions/#{lesson_key}/#{block_key}.md exist",
        path: path,
        line: line
      )
    end

    chosen = nested_exists ? nested : (flat_exists ? flat : nil)
    return nil unless chosen

    chosen_real = ensure_within_root!(chosen, context_path: path, line: line)
    reject_discovered_lesson_solution!(chosen_real, path: path, line: line)
    if ambiguous_lesson_key?(lesson_key) && chosen_real != explicit_real
      scoped_hint = single_block_lesson ? "solutions/#{module_key}/#{lesson_key}.md or solutions/#{module_key}/#{lesson_key}/#{block_key}.md" : "solutions/#{module_key}/#{lesson_key}/#{block_key}.md"
      fail_at!(
        "Ambiguous convention solution '#{relative_path(chosen)}' for lesson '#{lesson_key}' (defined in multiple modules); use #{scoped_hint} or an explicit solution_file",
        path: path,
        line: line
      )
    end

    chosen
  end

  def ambiguous_lesson_key?(lesson_key)
    (@lesson_key_modules&.fetch(lesson_key, nil)&.size || 0) > 1
  end

  def reject_discovered_lesson_solution!(real_path, path:, line:)
    lesson_rel = @discovered_lesson_realpaths&.[](real_path)
    return unless lesson_rel

    fail_at!(
      "solution_file cannot reference a discovered lesson file (#{lesson_rel})",
      path: path,
      line: line
    )
  end

  def parse_body_sections(lines, start_line:, path:)
    preamble_lines = []
    single_solution_lines = nil
    single_state = :body

    blocks = []
    current_block = nil
    fence_char = nil
    fence_len = 0
    fence_line = nil
    fence_base_indent = 0
    list_indents = []

    idx = 0
    while idx < lines.length
      line = lines[idx]
      line_no = start_line + idx

      if fence_char
        if closing_fence?(line, fence_char, fence_len, fence_base_indent)
          fence_char = nil
          fence_len = 0
          fence_line = nil
          fence_base_indent = 0
        end
        append_content_line!(line, current_block: current_block, preamble_lines: preamble_lines, single_solution_lines: single_solution_lines, single_state: single_state, path: path, line_no: line_no)
        idx += 1
        next
      end

      if (fence = update_list_containers_and_detect_fence(line, list_indents))
        fence_char, fence_len, fence_base_indent = fence
        fence_line = line_no
        append_content_line!(line, current_block: current_block, preamble_lines: preamble_lines, single_solution_lines: single_solution_lines, single_state: single_state, path: path, line_no: line_no)
        idx += 1
        next
      end

      if BLOCK_MULTILINE_OPEN.match?(line)
        list_indents.clear
        ensure_empty_preamble!(preamble_lines, single_solution_lines, path: path, line: line_no) if blocks.empty?
        yaml_lines = []
        open_line = line_no
        idx += 1
        closed = false
        while idx < lines.length
          if BLOCK_MULTILINE_CLOSE.match?(lines[idx])
            closed = true
            break
          end
          yaml_lines << lines[idx]
          idx += 1
        end
        fail_at!("Unterminated <!-- block ... --> marker", path: path, line: open_line) unless closed

        attrs = parse_yaml_mapping(yaml_lines.join("\n"), path: path, line: open_line)
        current_block = { attrs: attrs, body_lines: [], solution_lines: nil, state: :body, line: open_line }
        blocks << current_block
        idx += 1
        next
      end

      if (match = BLOCK_SINGLE_LINE.match(line))
        list_indents.clear
        ensure_empty_preamble!(preamble_lines, single_solution_lines, path: path, line: line_no) if blocks.empty?
        attrs = parse_inline_block_attrs(match[1], path: path, line: line_no)
        current_block = { attrs: attrs, body_lines: [], solution_lines: nil, state: :body, line: line_no }
        blocks << current_block
        idx += 1
        next
      end

      if SOLUTION_MARKER.match?(line)
        list_indents.clear
        if current_block
          fail_at!("Duplicate <!-- solution --> marker in the same block", path: path, line: line_no) unless current_block[:state] == :body
          current_block[:state] = :solution
          current_block[:solution_lines] = []
        else
          fail_at!("Duplicate <!-- solution --> marker in lesson", path: path, line: line_no) unless single_state == :body
          single_state = :solution
          single_solution_lines = []
        end
        idx += 1
        next
      end

      if END_SOLUTION_MARKER.match?(line)
        list_indents.clear
        if current_block
          fail_at!("Unexpected <!-- endsolution --> without a matching <!-- solution -->", path: path, line: line_no) unless current_block[:state] == :solution
          current_block[:state] = :after_solution
        else
          fail_at!("Unexpected <!-- endsolution --> without a matching <!-- solution -->", path: path, line: line_no) unless single_state == :solution
          single_state = :after_solution
        end
        idx += 1
        next
      end

      append_content_line!(line, current_block: current_block, preamble_lines: preamble_lines, single_solution_lines: single_solution_lines, single_state: single_state, path: path, line_no: line_no)
      idx += 1
    end

    if fence_char
      fail_at!("Unterminated fenced code block (#{fence_char * fence_len})", path: path, line: fence_line)
    end

    if blocks.any?
      {
        mode: :multi,
        blocks: blocks.map do |b|
          {
            attrs: b[:attrs],
            body: b[:body_lines].join("\n"),
            solution: b[:solution_lines]&.join("\n"),
            line: b[:line]
          }
        end
      }
    else
      {
        mode: :single,
        single: {
          body: preamble_lines.join("\n"),
          solution: single_solution_lines&.join("\n"),
          line: start_line
        }
      }
    end
  end

  def append_content_line!(line, current_block:, preamble_lines:, single_solution_lines:, single_state:, path:, line_no:)
    if current_block
      case current_block[:state]
      when :body
        current_block[:body_lines] << line
      when :solution
        current_block[:solution_lines] << line
      when :after_solution
        unless line.strip.empty?
          fail_at!("Unexpected content after <!-- endsolution -->; move learner content before <!-- solution --> or start a new <!-- block ... -->", path: path, line: line_no)
        end
      end
    else
      case single_state
      when :body
        preamble_lines << line
      when :solution
        single_solution_lines << line
      when :after_solution
        unless line.strip.empty?
          fail_at!("Unexpected content after <!-- endsolution -->; move learner content before <!-- solution -->", path: path, line: line_no)
        end
      end
    end
  end

  def ensure_empty_preamble!(preamble_lines, single_solution_lines, path:, line:)
    has_preamble = preamble_lines.any? { |l| !l.strip.empty? } || !single_solution_lines.nil?
    return unless has_preamble

    fail_at!("Content before the first <!-- block ... --> marker is not allowed in a multi-block lesson", path: path, line: line)
  end

  def update_list_containers_and_detect_fence(line, list_indents)
    return nil if line.match?(/\A[ \t]*\z/)

    cols, rest = split_leading_whitespace(line)
    list_indents.pop while list_indents.any? && cols < list_indents.last

    loop do
      base_indent = list_indents.last || 0
      rel_indent = cols - base_indent
      return nil unless rel_indent >= 0 && rel_indent <= 3

      if (fence = opening_fence_at_content(rest))
        return [ fence[0], fence[1], base_indent ]
      end

      break if THEMATIC_BREAK.match?(rest)

      list_match = LIST_ITEM_MARKER.match(rest)
      break unless list_match

      marker = list_match[1]
      sep = list_match[2]
      after = list_match[3] || ""
      after_marker_col = cols + marker.length

      if sep.nil? || after.empty?
        list_indents << (after_marker_col + 1)
        return nil
      end

      sep_end_col = advance_columns(after_marker_col, sep)
      if (sep_end_col - after_marker_col) > 4
        list_indents << (after_marker_col + 1)
        return nil
      end

      list_indents << sep_end_col
      cols = sep_end_col
      rest = after
    end

    nil
  end

  def split_leading_whitespace(line)
    match = /\A([ \t]*)(.*)\z/.match(line)
    [ advance_columns(0, match[1]), match[2] ]
  end

  def advance_columns(start_col, whitespace)
    col = start_col
    whitespace.each_byte do |byte|
      col = (byte == 9) ? (col + 4 - (col % 4)) : (col + 1)
    end
    col
  end

  def opening_fence_at_content(rest)
    match = /\A(`{3,}|~{3,})(.*)\z/.match(rest)
    return nil unless match

    marker = match[1]
    info = match[2]
    char = marker[0]
    return nil if char == "`" && info.include?("`")

    [ char, marker.length ]
  end

  def closing_fence?(line, fence_char, fence_len, fence_base_indent = 0)
    cols, rest = split_leading_whitespace(line)
    rel_indent = cols - fence_base_indent
    return false unless rel_indent >= 0 && rel_indent <= 3

    /\A#{Regexp.escape(fence_char)}{#{fence_len},}[ \t]*\z/.match?(rest)
  end

  def parse_inline_block_attrs(payload, path:, line:)
    trimmed = payload.strip
    if IDENTIFIER.match?(trimmed)
      return { "key" => trimmed }
    end

    if KV_ATTR_PREFIX.match?(trimmed)
      parse_kv_attrs(trimmed, path: path, line: line)
    elsif YAML_ATTR_PREFIX.match?(trimmed)
      parse_yaml_mapping("{#{trimmed}}", path: path, line: line)
    else
      fail_at!("Invalid <!-- block ... --> syntax: #{trimmed.inspect} (expected key=value pairs, YAML, or a block key)", path: path, line: line)
    end
  end

  def parse_kv_attrs(text, path:, line:)
    scanner = StringScanner.new(text)
    attrs = {}

    until scanner.eos?
      scanner.skip(/[ \t]+/)
      break if scanner.eos?

      key = scanner.scan(/[a-zA-Z_][a-zA-Z0-9_-]*/)
      unless key && scanner.scan(/=/)
        fail_at!("Invalid block attribute syntax near #{scanner.rest.inspect}", path: path, line: line)
      end

      value = if scanner.scan(/"/)
        scan_quoted_string(scanner, '"', path: path, line: line)
      elsif scanner.scan(/'/)
        scan_quoted_string(scanner, "'", path: path, line: line)
      else
        raw = scanner.scan(/[^\s"']+/)
        fail_at!("Missing value for block attribute '#{key}'", path: path, line: line) if raw.nil?
        raw
      end

      if attrs.key?(key)
        fail_at!("Duplicate attribute '#{key}' in block marker", path: path, line: line)
      end
      attrs[key] = value
    end

    attrs
  end

  def scan_quoted_string(scanner, quote, path:, line:)
    buffer = +""
    until scanner.eos?
      ch = scanner.getch
      if ch == "\\" && quote == '"'
        escaped = scanner.getch
        fail_at!("Unterminated escape in quoted block attribute", path: path, line: line) if escaped.nil?
        buffer << escaped
      elsif ch == quote
        return buffer
      else
        buffer << ch
      end
    end
    fail_at!("Unterminated quoted string in block marker", path: path, line: line)
  end

  def split_frontmatter(content, path:)
    stripped = content.sub(/\A\uFEFF/, "")
    lines = stripped.split("\n", -1)
    unless lines.first && FRONTMATTER_DELIMITER.match?(lines.first)
      fail_at!("Missing YAML frontmatter (file must start with ---)", path: path, line: 1)
    end

    closing_idx = nil
    (1...lines.length).each do |i|
      if FRONTMATTER_DELIMITER.match?(lines[i])
        closing_idx = i
        break
      end
    end
    fail_at!("Unterminated YAML frontmatter (missing closing ---)", path: path, line: 1) if closing_idx.nil?

    yaml_text = lines[1...closing_idx].join("\n")
    frontmatter = parse_yaml_mapping(yaml_text, path: path, line: 2)
    body_lines = lines[(closing_idx + 1)..] || []
    [ frontmatter, body_lines, closing_idx + 2 ]
  end

  def find_yaml_manifest(dir, basename)
    yml = File.join(dir, "#{basename}.yml")
    yaml = File.join(dir, "#{basename}.yaml")
    yml_exists = File.file?(yml)
    yaml_exists = File.file?(yaml)

    if yml_exists && yaml_exists
      fail_at!("Found both #{basename}.yml and #{basename}.yaml; keep only one", path: relative_path(dir))
    end
    unless yml_exists || yaml_exists
      fail_at!("Missing #{basename}.yml", path: relative_path(dir))
    end

    chosen = yml_exists ? yml : yaml
    ensure_within_root!(chosen, context_path: relative_path(chosen))
    chosen
  end

  def manifest_present?(dir, basename)
    File.file?(File.join(dir, "#{basename}.yml")) || File.file?(File.join(dir, "#{basename}.yaml"))
  end

  def load_yaml_hash(file_path)
    rel = relative_path(file_path)
    raw = safe_read_utf8(file_path, context_path: rel)
    parse_yaml_mapping(raw, path: rel, line: 1)
  end

  def parse_yaml_mapping(text, path:, line:)
    parsed = YAML.safe_load(text, permitted_classes: [ Date ], aliases: false, filename: path)
    unless parsed.is_a?(Hash)
      fail_at!("Expected a YAML mapping (key/value object)", path: path, line: line)
    end
    parsed
  rescue Psych::SyntaxError => error
    err_line = error.line ? (line - 1 + error.line) : line
    fail_at!("Invalid YAML: #{error.problem || error.message}", path: path, line: err_line)
  rescue Psych::AliasesNotEnabled
    fail_at!("YAML aliases are not allowed", path: path, line: line)
  rescue Psych::BadAlias => error
    fail_at!("Invalid YAML alias: #{error.message}", path: path, line: line)
  rescue Psych::DisallowedClass => error
    fail_at!("Unsupported YAML value: #{error.message}", path: path, line: line)
  end

  def safe_read_utf8(file_path, context_path:, line: nil)
    real = ensure_within_root!(file_path, context_path: context_path, line: line)
    content = File.read(real, encoding: Encoding::UTF_8)
    unless content.valid_encoding?
      fail_at!("File is not valid UTF-8", path: context_path, line: line)
    end
    content.gsub("\r\n", "\n").gsub("\r", "\n")
  end

  def ensure_within_root!(target_path, context_path:, line: nil)
    real = File.realpath(target_path)
    unless real == @root_path || real.start_with?("#{@root_path}#{File::SEPARATOR}")
      fail_at!("Path escapes source directory: #{target_path}", path: context_path, line: line)
    end
    real
  end

  def relative_path(target_path)
    Pathname.new(target_path).relative_path_from(Pathname.new(@root_path)).to_s
  rescue ArgumentError
    target_path.to_s
  end

  def validate_identifier!(value, label, path:, line: nil)
    unless value.is_a?(String) && IDENTIFIER.match?(value)
      fail_at!("Invalid #{label} #{value.inspect} (must match #{IDENTIFIER.source})", path: path, line: line)
    end
    value
  end

  def normalize_revision!(value, path:)
    normalized = value.is_a?(Date) ? value.iso8601 : value
    validate_text!(normalized, MAX_REVISION_LENGTH, "revision", required: true, path: path)
  end

  def validate_text!(value, maximum, label, required:, path:, line: nil)
    return nil if value.nil? && !required

    unless value.is_a?(String)
      fail_at!("Invalid #{label}: expected a string", path: path, line: line)
    end
    if required && value.strip.empty?
      fail_at!("Missing required #{label}", path: path, line: line)
    end
    if value.length > maximum
      fail_at!("#{label} exceeds maximum length of #{maximum} characters (got #{value.length})", path: path, line: line)
    end
    value
  end

  def validate_integer!(value, range, label, path:, line: nil)
    unless value.is_a?(Integer) && range.cover?(value)
      fail_at!("Invalid #{label} #{value.inspect} (expected integer in #{range})", path: path, line: line)
    end
    value
  end

  def validate_boolean!(value, label, path:, line: nil)
    unless [ true, false ].include?(value)
      fail_at!("Invalid #{label} #{value.inspect} (must be true or false)", path: path, line: line)
    end
    value
  end

  def validate_enum!(value, allowed, label, path:, line: nil)
    unless value.is_a?(String) && allowed.include?(value)
      fail_at!("Invalid #{label} #{value.inspect} (allowed: #{allowed.join(", ")})", path: path, line: line)
    end
    value
  end

  def validate_optional_module_type!(value, present, path:)
    return nil unless present

    validate_enum!(value, MODULE_TYPES, "module_type", path: path)
  end

  def validate_schedule_days!(value, path:)
    unless value.is_a?(String) && SCHEDULE_PATTERNS.key?(value)
      fail_at!("Invalid schedule_days #{value.inspect} (allowed: #{SCHEDULE_PATTERNS.keys.join(", ")})", path: path)
    end
    value
  end

  def validate_release_day!(value, total_days:, schedule_days:, path:, line:)
    day = validate_integer!(value, 0...total_days, "release_day", path: path, line: line)
    unless SCHEDULE_PATTERNS.fetch(schedule_days).include?(day % 7)
      fail_at!("Invalid release_day #{day} for schedule_days '#{schedule_days}'", path: path, line: line)
    end
    day
  end

  def validate_rubric!(rubric, path:, line:)
    unless rubric.is_a?(Hash)
      fail_at!("Invalid rubric: expected an object", path: path, line: line)
    end
    reject_unknown_keys!(rubric, RUBRIC_KEYS, path: path, line: line)

    title = validate_text!(rubric["title"], MAX_TITLE_LENGTH, "rubric title", required: true, path: path, line: line)
    description = validate_text!(rubric["description"], TEXT_LIMIT, "rubric description", required: false, path: path, line: line)
    criteria_raw = rubric["criteria"]
    unless criteria_raw.is_a?(Array) && (1..MAX_RUBRIC_CRITERIA).cover?(criteria_raw.size)
      fail_at!("Rubric must have between 1 and #{MAX_RUBRIC_CRITERIA} criteria", path: path, line: line)
    end

    criteria = criteria_raw.each_with_index.map do |criterion, idx|
      unless criterion.is_a?(Hash)
        fail_at!("Rubric criterion #{idx + 1} must be an object", path: path, line: line)
      end
      reject_unknown_keys!(criterion, CRITERION_KEYS, path: path, line: line)
      {
        "title" => validate_text!(criterion["title"], MAX_TITLE_LENGTH, "rubric criterion #{idx + 1} title", required: true, path: path, line: line),
        "description" => validate_text!(criterion["description"], MAX_CRITERION_DESCRIPTION, "rubric criterion #{idx + 1} description", required: true, path: path, line: line)
      }
    end

    result = { "title" => title }
    result["description"] = description unless description.nil?
    result["criteria"] = criteria
    result
  end

  def reject_media_keys!(hash, path:, line: nil)
    media_key = hash.keys.find { |k| k.to_s.match?(MEDIA_KEY_PATTERN) }
    return unless media_key

    fail_at!("Media must be attached through the normal upload flow (disallowed key '#{media_key}')", path: path, line: line)
  end

  def reject_unknown_keys!(hash, allowed, path:, line: nil)
    unknown = hash.keys.map(&:to_s) - allowed
    return if unknown.empty?

    fail_at!("Unknown key(s): #{unknown.sort.join(", ")}", path: path, line: line)
  end

  def media_reference_in_body?(body)
    return false if body.empty?

    MEDIA_BODY_URI_PATTERN.match?(body) || MEDIA_BODY_S3_KEY_PATTERN.match?(body)
  end

  def validate_byte_limit!(json, path:)
    return if json.bytesize <= MAX_BYTES

    fail_at!("Generated package JSON exceeds 2 MB limit (#{json.bytesize} bytes > #{MAX_BYTES})", path: path)
  end

  def fail_at!(message, path: nil, line: nil)
    raise Error.new(message, path: path, line: line)
  end
end
